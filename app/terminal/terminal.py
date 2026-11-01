"""
一个基于 pexpect 的非阻塞伪终端会话包装器，支持异步输出回调。

- 使用后台线程持续通过 ``read_nonblocking`` 从伪终端读取输出。
- 每读到一段数据，就把异步回调协程提交到 Terminal 自己的后台事件循环中执行
  ，从而支持 ``async def`` 形式的回调。
- 不依赖 ``CallbackLogfile``，完全由内部读取线程驱动回调。
"""

import asyncio
import concurrent.futures
import inspect
import threading
import traceback
from pathlib import Path
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Optional,
    Self,
    Set,
    Tuple,
    Union,
)

import pexpect


# 输出流的异步回调函数
TerminalOutputCallbackAsync = Callable[[bytes], Awaitable[Any]]


class Terminal:
    """
    非阻塞的命令行解释器包装器，支持异步输出回调。

    内部使用 ``pexpect.spawn`` 启动一个子进程（默认 ``bash``），并通过
    后台线程持续读取子进程的合并输出（stdout 与 stderr）。每当读到一段
    新数据，就把用户提供的**异步**回调协程提交到 Terminal 自有的后台事件
    循环中执行，因此在 ``async def`` 回调里可以安全地 ``await``（IO、锁、
    队列等），而不会阻塞输出读取线程，也不会占用调用方的事件循环。

    线程模型
    --------
    一个进入上下文的 Terminal 实例会启动两个后台守护线程：

    - **读取线程**：在 ``read_nonblocking`` 上以约 100ms 的超时轮询 pty，
      读到数据就交给 :meth:`_dispatch_output`，绝不阻塞。
    - **事件循环线程**：运行一个由本实例独占的 ``asyncio`` 事件循环，
      通过 ``asyncio.run_coroutine_threadsafe`` 逐个执行回调协程；
      只调度本实例提交的 Future，不使用 ``asyncio.all_tasks``，
      因此不会误伤共享同一循环的其他任务。

    所有公开方法（:meth:`send`、:attr:`dimensions`、:attr:`alive`、
    :meth:`close` 等）均为非阻塞调用，适合在异步或事件驱动环境中使用。
    输出到达的顺序与分块形态取决于 pty 的缓冲，回调可能收到跨行的碎片数据，
    调用方如需完整语义请自行拼装或做终端仿真。

    生命周期
    --------
    - 推荐通过上下文管理器使用（``with Terminal(...) as c: ...``），
      ``__exit__`` 会自动调用 :meth:`close`。
    - :meth:`close` 可安全重复调用：先置关闭标志短路后续分发，
      再 join 读取线程、关闭子进程、取消并等待本实例提交的 Future，
      最后停用并关闭后台事件循环。
    - 若 ``__enter__`` 在启动子进程后抛异常，内部也会走 :meth:`close`
      做回滚，避免线程 / 子进程 / 事件循环泄漏。

    示例
    ----
    .. code-block:: python

        async def on_output(data: bytes) -> None:
            print(data.decode("utf-8", errors="replace"), end="", flush=True)

        with Terminal(output_callback=on_output) as term:
            term.send(b"ls\\n")
            # 回调在本实例自己的事件循环上执行，不会占用调用方的 loop
    """

    def __init__(
        self,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        *,
        cwd: Optional[Union[str, Path]] = None,
        env: Optional[Dict[str, Any]] = None,
        dimensions: Optional[Tuple[int, int]] = None,
        output_callback: Optional[TerminalOutputCallbackAsync] = None,
    ):
        """
        初始化 Terminal 实例，此时并未启动子进程。

        Args:
            command: 要在伪终端中执行的命令（完整路径或命令名），默认使用 "bash"。
            args: 命令的参数列表。如果 ``command`` 已包含参数，可省略此参数。
            cwd: 子进程的初始工作目录。若为 ``None``，则继承父进程的当前工作目录。
            env: 子进程的环境变量字典。若为 ``None``，则继承父进程的环境变量。
            dimensions: 伪终端的初始尺寸 ``(rows, columns)``。
            output_callback: 当输出流（stdout 与 stderr）有新数据时调用的异步回调，
                接收一个 ``bytes`` 参数，返回 awaitable。
        """
        self._command: str = "bash" if (command is None) else command
        self._args: Optional[List[str]] = args
        self._cwd: Optional[str] = None if cwd is None else str(cwd)
        self._env: Optional[Dict[str, Any]] = env
        self._initial_dimensions: Optional[Tuple[int, int]] = dimensions
        self._output_callback: Optional[TerminalOutputCallbackAsync] = output_callback

        # 子进程对象，直到 __enter__ 中才创建
        self._child: Optional[pexpect.spawn] = None

        # 后台读取线程
        self._reader_thread: Optional[threading.Thread] = None
        self._stop_reading = threading.Event()

        # 后台事件循环 / 线程
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ready: Optional[threading.Event] = None
        self._loop_thread: Optional[threading.Thread] = None

        # 跟踪本 Terminal 自己提交的 Future：
        # 关闭时只 cancel 这些，绝不使用 asyncio.all_tasks()，
        # 避免误伤同一 loop 上由他人提交的任务。
        self._pending: Set[concurrent.futures.Future] = set()
        self._pending_lock = threading.Lock()

        # 关闭标志：置位后 _dispatch_output 立即短路，拒绝再往 loop 提交。
        self._closing = False


    # ============================================================
    # 后台事件循环
    # ============================================================

    def _run_loop(self) -> None:
        loop, ready = self._loop, self._ready
        if loop is None or ready is None:
            return
        try:
            asyncio.set_event_loop(loop)
        except BaseException:
            traceback.print_exc()
        finally:
            # 无论 set_event_loop 成败都放行主线程，否则 _init_loop 会死等。
            ready.set()
        try:
            loop.run_forever()
        except BaseException:
            # run_forever 抛异常时不能让线程"静默死亡"，至少留下痕迹。
            traceback.print_exc()


    def _init_loop(self) -> None:
        # 防止 Terminal 被复用时残留上一轮的 pending。
        with self._pending_lock:
            self._pending.clear()
        self._closing = False

        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._loop_thread = threading.Thread(
            target=self._run_loop,
            name=f"terminal-loop-{id(self):x}",
            daemon=True,
        )
        self._loop_thread.start()
        if not self._ready.wait(timeout=10):
            # 线程 10s 内没就绪，说明后台出了问题；清理后向上抛，别让主线程陪死等。
            self._shutdown_loop()
            raise RuntimeError("Terminal background event loop failed to start")


    def _shutdown_loop(self) -> None:
        loop, thread = self._loop, self._loop_thread
        # 先置空，保证重复调用幂等。
        self._loop = None
        self._loop_thread = None
        self._ready = None
        if loop is None or loop.is_closed():
            if thread is not None:
                thread.join()
            return
        try:
            loop.call_soon_threadsafe(loop.stop)
        except RuntimeError:
            # loop 已在别的路径上被关闭
            pass
        if thread is not None:
            thread.join()
        loop.close()


    # ============================================================
    # 输出分发
    # ============================================================

    async def _drive(self, aw: Awaitable[Any]) -> Any:
        # 包装一层，使 run_coroutine_threadsafe 能接受任意 Awaitable，
        # 而不只是 coroutine。
        return await aw


    def _dispatch_output(self, data: bytes) -> None:
        """
        由后台读取线程同步调用。
        这里只负责把异步回调安全地丢进本 Terminal 的 loop，绝不阻塞读取线程。
        """
        if self._closing or self._output_callback is None:
            return
        loop = self._loop
        if loop is None or loop.is_closed():
            return

        try:
            aw = self._output_callback(data)
        except Exception:
            traceback.print_exc()
            return

        if not inspect.isawaitable(aw):
            # 用户误传同步回调，或回调返回了非 awaitable 的值。
            traceback.print_exception(
                TypeError("output_callback must return an awaitable")
            )
            return

        wrapper = self._drive(aw)
        try:
            fut = asyncio.run_coroutine_threadsafe(wrapper, loop)
        except RuntimeError:
            # loop 正在关闭 / 已关闭：就地关闭协程，避免
            # "coroutine was never awaited" 警告。
            wrapper.close()
            if inspect.iscoroutine(aw):
                aw.close()
            return

        with self._pending_lock:
            self._pending.add(fut)
        fut.add_done_callback(self._on_dispatch_done)


    def _on_dispatch_done(self, fut: concurrent.futures.Future) -> None:
        # 在 loop 线程上执行，需要和 _dispatch_output 的 add 互斥。
        with self._pending_lock:
            self._pending.discard(fut)
        exc = fut.exception()
        if exc is not None:
            # 不吞异常：后台异步回调失败也要可见。
            traceback.print_exception(exc)


    def _cancel_pending(self, timeout: float = 5.0) -> None:
        """
        取消并等待本 Terminal 自己提交的 Future。
        只处理 _pending 里的对象，不影响同一 loop 上他人的任务。
        """
        with self._pending_lock:
            pending = list(self._pending)
        if not pending:
            return
        for f in pending:
            f.cancel()  # 通过 _chain_future 传播到 asyncio Task
        concurrent.futures.wait(pending, timeout=timeout)


    # ============================================================
    # 后台读取线程
    # ============================================================

    def _read_output(self) -> None:
        """
        在后台线程中持续读取子进程输出。

        使用 ``read_nonblocking`` 以非阻塞方式获取数据，
        有新数据时通过 ``_dispatch_output`` 提交给异步回调。
        当子进程退出或收到停止信号时退出循环。
        """
        child = self._child
        if child is None:
            return

        while child.isalive():
            if self._stop_reading.is_set():
                break
            try:
                data = child.read_nonblocking(size=4096, timeout=0.1)
                if data:
                    self._dispatch_output(data)
            except pexpect.TIMEOUT:
                # 超时无数据，继续循环
                continue
            except pexpect.EOF:
                # 子进程已结束
                break
            except Exception:
                # 捕获其他意外异常（如 OSError），安全退出线程
                break

        if self._stop_reading.is_set():
            return

        # 子进程结束后再尝试清空残余数据
        try:
            while True:
                data = child.read_nonblocking(size=4096, timeout=0)
                if not data:
                    break
                self._dispatch_output(data)
        except (pexpect.EOF, pexpect.TIMEOUT):
            pass
        except Exception:
            pass


    # ============================================================
    # 上下文管理器协议
    # ============================================================

    def __enter__(self) -> Self:
        """
        启动伪终端子进程，并开始后台事件循环 + 后台输出读取线程。
        """
        self._init_loop()

        spawn_kwargs = {
            "cwd": self._cwd,
            "env": self._env,
            "dimensions": self._initial_dimensions,
        }
        spawn_kwargs = {k: v for k, v in spawn_kwargs.items() if v is not None}

        try:
            if self._args:
                self._child = pexpect.spawn(self._command, self._args, **spawn_kwargs)
            else:
                self._child = pexpect.spawn(self._command, **spawn_kwargs)

            # 重置停止标志并启动输出读取线程
            self._stop_reading.clear()
            self._reader_thread = threading.Thread(
                target=self._read_output,
                name=f"Terminal-reader-{id(self):x}",
                daemon=True,
            )
            self._reader_thread.start()
        except BaseException:
            # __enter__ 抛异常时 __exit__ 不会被调用，需要手动清理
            self.close()
            raise

        return self


    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文时关闭 Terminal。"""
        self.close()


    # ============================================================
    # 公开属性与方法
    # ============================================================

    @property
    def dimensions(self) -> Tuple[int, int]:
        """
        返回伪终端的当前窗口尺寸 ``(rows, columns)``。

        Raises:
            RuntimeError: 如果 Terminal 尚未启动（未进入上下文）。
        """
        if self._child is None:
            raise RuntimeError("Terminal 尚未启动")
        return self._child.getwinsize()


    @dimensions.setter
    def dimensions(self, value: Tuple[int, int]) -> None:
        """
        设置伪终端的窗口尺寸。

        Args:
            value: 包含 ``(rows, columns)`` 的元组。

        Raises:
            RuntimeError: 如果 Terminal 尚未启动。
        """
        if self._child is None:
            raise RuntimeError("Terminal 尚未启动")
        self._child.setwinsize(*value)


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
        if self._child is None:
            raise RuntimeError("Terminal 尚未启动")
        return self._child.send(s)


    def close(self) -> bool:
        """
        关闭当前 Terminal 实例。可安全多次调用。
        """
        # 立即短路后续 _dispatch_output，避免关闭过程中的残留读取
        # 又往即将停掉的 loop 里塞任务。
        self._closing = True

        # 1. 通知并等待读取线程退出
        self._stop_reading.set()
        if self._reader_thread is not None and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=2)
        self._reader_thread = None

        # 2. 关闭子进程
        child = self._child
        self._child = None
        if child is not None and child.isalive():
            try:
                child.close(force=True)
            except Exception:
                traceback.print_exc()

        # 3. 取消 / 等待本 Terminal 自己的任务（在 loop 还活着时做，
        #    这样 cancel 信号能真正传到 asyncio Task）。
        self._cancel_pending()

        # 4. 停 loop、join 线程、close loop。幂等。
        self._shutdown_loop()

        return True


    def exit(self) -> bool:
        """
        关闭当前 Terminal 实例，等价于 :meth:`close`。

        Returns:
            ``True`` 表示操作完成。
        """
        return self.close()


    @property
    def alive(self) -> bool:
        """
        表示 Terminal 是否仍处于活动状态。

        如果伪终端尚未启动或子进程已退出，返回 ``False``。
        """
        return self._child is not None and self._child.isalive()
