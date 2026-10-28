"""
基于 :class:`Terminal` 的会话层包装，负责记录活动状态与历史输出。

本模块在 :class:`~.terminal.Terminal` 之上**组合**出一个有状态的会话对象
:class:`TerminalSession`，在保留伪终端全部原有能力（spawn、非阻塞
``send``、尺寸调整、异步输出回调）的同时，额外承担两类**会话级**职责：

- **活动状态跟踪**：记录最后一次活动时间，并据此判断会话是否因空闲
  超过 ``idle_timeout`` 而过期（:attr:`TerminalSession.expired` /
  :attr:`TerminalSession.expired_at`）。
- **输出历史维护**：缓存子进程的输出片段，在遇到清屏转义序列时清空，
  并在 :attr:`TerminalSession.history` 被访问时合并返回。

线程模型
--------
``TerminalSession`` 本身不创建线程。所有多线程访问都来自 ``Terminal`` 的
后台读取线程，具体表现为：

- :meth:`TerminalSession._output_callback` 在 ``Terminal`` 的**读取线程**
  上同步调用（因为它在回调里同步完成了历史记录，再返回 awaitable）；
- :meth:`TerminalSession.send` 由调用方线程执行；
- :attr:`TerminalSession.history` / :attr:`~TerminalSession.expired` 等
  属性可能被任意线程读取。

因此会话内部对 ``_histories`` 的写读使用 ``threading.Lock`` 保护；
``_last_active_time`` 为单个浮点数的覆盖写，在多线程下不保证严格
因果顺序，但用于"是否空闲过期"这一粗粒度判断是可接受的。

生命周期
--------
:class:`TerminalSession` 本身没有独立于 ``Terminal`` 的生命周期：

- 通过上下文管理器使用：``with TerminalSession(...) as s: ...``，
  ``__enter__`` / ``__exit__`` 直接转发给内部 ``Terminal``。
- :meth:`close` / :meth:`exit` 等价于对内部 ``Terminal`` 调用 ``close``，
  可安全重复调用。
- 会话过期并不自动关闭子进程；是否清理由上层调度器决定（例如定时扫描
  :attr:`expired` 为真的会话并调用 :meth:`close`）。

注意事项
--------
- 历史输出按 pty 读取的**原始分块**保存，可能包含跨行碎片、ANSI 转义
  序列，不做终端仿真或行重组。需要完整语义的调用方应自行拼接或引入
  终端解析器。
- 清屏检测仅覆盖 ``ESC[J``、``ESC[2J``、``ESC[3J`` 三种序列；若子进程
  使用其他清屏方式，历史不会被重置。
- :attr:`history` 的 getter 带副作用：它会刷新最后活动时间，并把多条
  历史就地压缩为一条。把它当成"带续命与压缩副作用的读取"，不要当纯
  访问器缓存使用。
- 注入给 ``Terminal`` 的回调**必须返回 awaitable**：本模块通过返回
  :func:`_noop` 保证 raw 回调为 ``None`` 时也满足该约束；若自定义回调
  返回非 awaitable，会被 ``Terminal._dispatch_output`` 视为误用并打印
  ``TypeError``。

示例
----
.. code-block:: python

    async def on_output(data: bytes) -> None:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()

    with TerminalSession(
        output_callback=on_output,
        idle_timeout=3600,
    ) as session:
        session.send(b"echo hello\\n")
        # 读取累计输出（读操作会刷新活动时间）
        # print(session.history.decode("utf-8", errors="replace"))
        # 空闲一小时后 session.expired 变为 True，由调度器自行 close
"""

from numbers import Real
from pathlib import Path
import threading
import time
from typing import Any, Awaitable, ClassVar, Dict, List, Optional, Self, Tuple, Union

from .terminal import Terminal, TerminalOutputCallbackAsync



async def _noop() -> None:
    return None


class TerminalSession:
    """记录 Terminal 的活动状态、历史记录"""

    # Terminal 的不活动过期时长
    DEFAULT_IDLE_TIMEOUT: ClassVar[Real] = 86400

    def __init__(
        self,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        *,
        cwd: Optional[Union[str, Path]] = None,
        env: Optional[Dict[str, Any]] = None,
        dimensions: Optional[Tuple[int, int]] = None,
        output_callback: Optional[TerminalOutputCallbackAsync] = None,
        idle_timeout: Optional[Real] = None,
    ):
        """
        Args:
            command: 要在伪终端中执行的命令（完整路径或命令名）。
                若为 ``None``，默认使用 ``"bash"``。
            args: 命令的参数列表。如果 ``command`` 已包含参数，可省略此参数。
            cwd: 子进程的初始工作目录。若为 ``None``，则继承父进程的当前工作目录。
            env: 子进程的环境变量字典。若为 ``None``，则继承父进程的环境变量。
            dimensions: 伪终端的初始尺寸 ``(rows, columns)``。
            output_callback: 当输出流（stdout 与 stderr）有新数据时调用的回调函数，
                接收一个 ``bytes`` 参数。默认不做任何处理。
            idle_timeout: 当一个 Terminal 的“不活动”时长超过这个值时，认为该 Terminal 过期了。
        """
        self.idle_timeout: Real = idle_timeout or self.DEFAULT_IDLE_TIMEOUT
        self._last_active_time: Real = time.time()
        self._raw_output_callback: Optional[TerminalOutputCallbackAsync] = output_callback
        self._histories: List[bytes] = []
        self._lock = threading.Lock()

        self._terminal = Terminal(
            command=command,
            args=args,
            cwd=cwd,
            env=env,
            dimensions=dimensions,
            output_callback=self._output_callback,
        )


    def __str__(self) -> str:
        return f"{type(self).__name__}<{self._terminal}>"


    def __enter__(self) -> Self:
        """
        启动伪终端子进程，并开始后台输出读取。

        Returns:
            TerminalSession 实例自身。
        """
        self._terminal.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文时关闭 Terminal。"""
        self._terminal.__exit__(exc_type, exc_val, exc_tb)


    # ==== Terminal 操作 ====

    @property
    def dimensions(self) -> Tuple[int, int]:
        """
        返回伪终端的当前窗口尺寸 ``(rows, columns)``。

        Raises:
            RuntimeError: 如果 Terminal 尚未启动（未进入上下文）。
        """
        return self._terminal.dimensions


    @dimensions.setter
    def dimensions(self, value: Tuple[int, int]) -> None:
        """
        设置伪终端的窗口尺寸。

        Args:
            value: 包含 ``(rows, columns)`` 的元组。

        Raises:
            RuntimeError: 如果 Terminal 尚未启动。
        """
        self._terminal.dimensions = value


    def send(self, s: bytes) -> int:
        """
        向伪终端的标准输入写入字节。

        该方法不会自动追加换行符，如有需要调用者应当显式添加 ``b"\\n"``。

        Args:
            s: 要写入的字节串。

        Returns:
            实际写入的字节数。

        Raises:
            RuntimeError: 如果 Terminal 尚未启动。
        """
        # 更新最后活动时间
        self._last_active_time = time.time()
        return self._terminal.send(s)


    def close(self) -> bool:
        """
        关闭当前 Terminal 实例。

        停止后台读取线程，并强制终止子进程。
        可以安全地多次调用。

        Returns:
            关闭操作是否完成（成功返回 ``True``）。
        """
        return self._terminal.close()


    def exit(self) -> bool:
        """
        关闭当前 Terminal 实例，等价于 :meth:`close`。

        Returns:
            ``True`` 表示操作完成。
        """
        return self._terminal.close()


    @property
    def alive(self) -> bool:
        """
        表示 Terminal 是否仍处于活动状态。

        如果伪终端尚未启动或子进程已退出，返回 ``False``。
        """
        return self._terminal.alive


    # ==== 管理 Terminal ====

    @property
    def expired_at(self) -> float:
        """
        返回该会话的过期时间戳（单位：秒）。
        """
        return self._last_active_time + self.idle_timeout


    @expired_at.setter
    def expired_at(self, value: Real) -> None:
        """
        设置该会话的过期时间戳（单位：秒）。
        """
        self._last_active_time = value - self.idle_timeout


    @property
    def expired(self) -> bool:
        """
        该 Terminal 会话是否过期。
        """
        return self.expired_at < time.time()


    def _output_callback(self, s: bytes) -> Awaitable[Any]:
        """
        包装 output_callback，记录到历史，并更新最后活动时间。
        """
        # 更新最后活动时间
        self._last_active_time = time.time()

        # 检查清屏命令，释放历史记录
        if (b"\x1B[J" in s) or (b"\x1B[2J" in s) or (b"\x1B[3J" in s):
            self._histories.clear()

        # 记录到历史
        with self._lock:
            self._histories.append(s)

        # 调用原回调函数
        if self._raw_output_callback is None:
            return _noop()
        return self._raw_output_callback(s)


    @property
    def history(self) -> bytes:
        """
        返回所有的历史记录。
        """
        # 更新最后活动时间
        self._last_active_time = time.time()

        # 如果只有一条历史，则直接输出
        if len(self._histories) == 1:
            return self._histories[0]

        # 合并历史
        with self._lock:
            history = b''.join(self._histories)
            self._histories.clear()
            self._histories.append(history)
            return history
