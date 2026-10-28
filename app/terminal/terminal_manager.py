from functools import partial
from numbers import Real
from pathlib import Path
from uuid import uuid4
import time
from typing import Any, Awaitable, Callable, ClassVar, Dict, List, Optional, Tuple, Union

from ..exceptions import TerminalNotFoundException, TerminalExistsException
from .terminal import TerminalOutputCallbackAsync
from .terminal_session import TerminalSession


# Terminal ID 类型
TerminalID: type = str

def _uuid4_str() -> TerminalID:
    return TerminalID(uuid4())


TerminalManagerOutputCallbackAsync = Callable[[bytes, Optional[TerminalID]], Any]



class TerminalManager:
    """创建、查询、关闭并定时清理 Terminal 实例。"""

    # Terminal 的不活动过期时长
    DEFAULT_IDLE_TIMEOUT: ClassVar[Real] = TerminalSession.DEFAULT_IDLE_TIMEOUT

    # 清理过期 Terminal 的时间间隔
    DEFAULT_CLEANUP_INTERVAL: ClassVar[Real] = 86400

    def __init__(
        self,
        initial_cwd: Optional[Union[str, Path]] = None,
        *,
        output_callback: Optional[TerminalManagerOutputCallbackAsync] = None,
        idle_timeout: Optional[Real] = None,
        cleanup_interval: Optional[Real] = None,
        terminal_id_gen: Optional[Callable[..., TerminalID]] = None,
    ):
        """
        Args:
            initial_cwd: 新创建的 Terminal 的默认初始工作目录。默认为当前工作目录
            output_callback: 当某一个 Terminal 有输出时，调用的回调函数。
            idle_timeout: 当一个 Terminal 的“不活动”时长超过这个值时，认为该 Terminal 过期了。
            cleanup_interval: 清理过期 Terminal 的时间间隔。
            terminal_id_gen: 生成 Terminal ID 的函数。默认生成 UUID4。

        向 Terminal 写入标准输入、Terminal 产生输出都会被视为该 Terminal 的“活动”。
        """
        self.initial_cwd: Path = Path(initial_cwd or Path.cwd()).resolve()
        self._raw_output_callback: Optional[TerminalManagerOutputCallbackAsync] = output_callback
        self.idle_timeout: Real = idle_timeout or self.DEFAULT_IDLE_TIMEOUT
        self.cleanup_interval: Real = cleanup_interval or self.DEFAULT_CLEANUP_INTERVAL
        self._last_cleanup_time: Real = time.time()
        self.terminal_id_gen = terminal_id_gen or _uuid4_str

        # TerminalSession 实例
        self._sessions: Dict[TerminalID, TerminalSession] = {}


    def clean_up_expired(self) -> None:
        """
        清理过期的 TerminalSession。
        """
        for terminal_id, session in tuple(self._sessions.items()):
            if session.expired:
                session.exit()
                self._sessions.pop(terminal_id)
        self._last_cleanup_time = time.time()


    @property
    def sessions(self) -> Dict[str, TerminalSession]:
        """
        返回经过清理的 TerminalSession 容器。
        """
        if self._last_cleanup_time + self.cleanup_interval < time.time():
            self.clean_up_expired()
        return self._sessions


    async def _output_callback(self, s: bytes, terminal_id: TerminalID) -> Any:
        """
        包装 output_callback，添加 terminal_id 参数。
        """
        if self._raw_output_callback is None:
            return None
        return await self._raw_output_callback(s, terminal_id)


    def create(
        self,
        terminal_id: Optional[TerminalID] = None,
        command: Optional[str] = None,
        args: Optional[List[str]] = None,
        *,
        cwd: Optional[Union[str, Path]] = None,
        env: Optional[Dict[str, Any]] = None,
        dimensions: Optional[Tuple[int, int]] = None,
        idle_timeout: Optional[Real] = None,
    ) -> TerminalID:
        """
        创建一个 TerminalSession，返回其 ID。

        Args:
            terminal_id: 指定要创建的中端的 ID。

        Raises:
            TerminalExistsException: 要创建的 Terminal ID 已存在。
        """
        if terminal_id:
            if terminal_id in self.sessions:
                raise TerminalExistsException(terminal_id)
        else:
            # 生成新 ID
            terminal_id = self.terminal_id_gen()

        # 创建新 Session
        session = TerminalSession(
            command=command,
            args=args,
            cwd=cwd or self.initial_cwd,
            env=env,
            dimensions=dimensions,
            output_callback=partial(self._output_callback, terminal_id=terminal_id),
            idle_timeout=idle_timeout or self.idle_timeout,
        )
        self.sessions[terminal_id] = session
        return terminal_id


    def get(self, terminal_id: TerminalID) -> TerminalSession:
        """
        通过 terminal_id 获取一个已经启动的 TerminalSession。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        # 检查存在性
        if terminal_id not in self.sessions:
            raise TerminalNotFoundException(terminal_id)

        session = self.sessions[terminal_id]
        if not session.alive:
            session.__enter__()
        return session


    def send(self, terminal_id: TerminalID, s: bytes) -> int:
        """
        向伪终端的标准输入写入字节。

        该方法不会自动追加换行符，如有需要调用者应当显式添加 ``b"\\n"``。

        Args:
            terminal_id: 被写入的 Terminal 的 ID。
            s: 要写入的字节串。

        Returns:
            实际写入的字节数。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        session = self.get(terminal_id)
        return session.send(s)


    def delete(self, terminal_id: TerminalID) -> bool:
        """
        关闭并删除 Terminal。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        session = self.get(terminal_id)
        success = session.exit()
        if success:
            self._sessions.pop(terminal_id)
        return success


    def is_expired(self, terminal_id: TerminalID) -> bool:
        """
        若 ID 为 terminal_id 的 terminal 已过期，则返回 True。
        """
        session = self.get(terminal_id)
        return session.expired


    def is_alive(self, terminal_id: TerminalID) -> bool:
        """
        若 ID 为 terminal_id 的 terminal 仍然存在且没有过期，则返回 True。
        """
        if terminal_id not in self.sessions:
            return False
        session = self.get(terminal_id)
        return session.is_alive and not session.expired


    def get_dimensions(self, terminal_id: TerminalID) -> Tuple[int, int]:
        """
        获取 ID 为 terminal_id 的 terminal 的尺寸 `(rows, columns)`。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        session = self.get(terminal_id)
        return session.dimensions


    def set_dimensions(self, terminal_id: TerminalID, dimensions: Tuple[int, int]) -> Tuple[int, int]:
        """
        修改 ID 为 terminal_id 的 terminal 的尺寸 `(rows, columns)`。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        session = self.get(terminal_id)
        session.dimensions = dimensions
        return session.dimensions


    def get_history(self, terminal_id: TerminalID) -> bytes:
        """
        获取 ID 为 terminal_id 的 terminal 的所有历史记录。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        session = self.get(terminal_id)
        return session.history


    def get_expired_at(self, terminal_id: TerminalID) -> float:
        """
        获取 ID 为 terminal_id 的 terminal 的过期时间。
        """
        session = self.get(terminal_id)
        return session.expired_at
