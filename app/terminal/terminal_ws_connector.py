import asyncio
import logging
from numbers import Real
from pathlib import Path
import time
from typing import Any, Callable, ClassVar, Dict, List, Optional, Set, Tuple, Union

from fastapi import WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

from ..exceptions import TerminalNotFoundException
from .terminal_manager import TerminalManager, TerminalID


class TerminalWSConnector:
    """
    将 Terminal 与 WebSocket 之间建立一对多关系。
    """

    # 清理过期 Terminal 连接的时间间隔
    DEFAULT_CLEANUP_INTERVAL: ClassVar[Real] = TerminalManager.DEFAULT_CLEANUP_INTERVAL

    def __init__(
        self,
        *,
        cleanup_interval: Optional[Real] = None,
        terminal_id_gen: Optional[Callable[..., TerminalID]] = None,
    ):
        """
        Args:
            cleanup_interval: 清理与过期 Terminal 相连的 WebSocket 的时间间隔。
            terminal_id_gen: 生成 Terminal ID 的函数。默认生成 UUID4。
        """
        self.cleanup_interval: Real = cleanup_interval or self.DEFAULT_CLEANUP_INTERVAL
        self._last_cleanup_time: Real = time.time()
        self._manager: TerminalManager = TerminalManager(
            cleanup_interval=self.cleanup_interval,
            terminal_id_gen=terminal_id_gen,
            output_callback=self._output_callback,
        )
        self._lock = asyncio.Lock()

        # 各 Terminal 的输出广播列表
        self._websockets: Dict[TerminalID, Set[WebSocket]] = {}


    @staticmethod
    async def _safe_close(websocket: WebSocket) -> None:
        try:
            await websocket.close()
        except Exception:
            pass


    async def clean_up_expired(self) -> None:
        """
        清理已失效的 TerminalSession。
        """
        async with self._lock:
            dead_ws: list[WebSocket] = []
            for tid in [t for t in self._websockets if not self._manager.is_alive(t)]:
                dead_ws.extend(self._websockets.pop(tid, set()))
            self._last_cleanup_time = time.time()

        # 关闭 WebSocket
        if dead_ws:
            tasks = map(self._safe_close, dead_ws)
            await asyncio.gather(*tasks, return_exceptions=True)


    async def create_terminal(
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

        Raises:
            TerminalExistsException: 如果 terminal_id 已存在。
        """
        terminal_id = self._manager.create(
            terminal_id=terminal_id,
            command=command,
            args=args,
            cwd=cwd,
            env=env,
            dimensions=dimensions,
            idle_timeout=idle_timeout,
        )
        async with self._lock:
            self._websockets[terminal_id] = set()
        return terminal_id


    async def get_terminal_info(
        self,
        terminal_id: TerminalID
    ) -> Dict[str, str | int]:
        """
        获取单个 Terminal 的信息。

        Returns like:

        {
            "id": "...",
            "width": ...,
            "height": ...,
            "expired_at": "...",
        }
        """
        dimensions = self._manager.get_dimensions(terminal_id)
        expired_at = self._manager.get_expired_at(terminal_id)
        return {
            "id": terminal_id,
            "width": dimensions[1],
            "height": dimensions[0],
            "expired_at": expired_at,
        }


    async def get_all_terminal_info(self) -> List[Dict[str, str | int]]:
        """
        获取所有 Terminal 的信息。

        Returns like:

        [
            {
                "id": "...",
                "expired_at": "..."
            },
            {
                "id": "...",
                "expired_at": "..."
            }
        ]
        """
        async with self._lock:
            terminal_ids = list(self._websockets.keys())
        return await asyncio.gather(*map(self.get_terminal_info, terminal_ids))


    async def delete_terminal(self, terminal_id: TerminalID) -> None:
        """
        关闭一个 Terminal 实例，并断开与它连接的所有 WebSockets。
        """
        await self.disconnect_all(terminal_id)
        self._manager.delete(terminal_id)


    def send(self, terminal_id: TerminalID, data: bytes) -> int:
        """
        向伪终端的标准输入写入字节。

        该方法不会自动追加换行符，如有需要调用者应当显式添加 ``b"\\n"``。

        Args:
            terminal_id: 被写入的 Terminal 的 ID。
            data: 要写入的字节串。

        Returns:
            实际写入的字节数。

        Raises:
            TerminalNotFoundException: 如果 ID 为 terminal_id 的 TerminalSession 不存在或已过期。
        """
        return self._manager.send(terminal_id, data)


    async def _send_to_ws(
        self,
        data: bytes,
        websocket: WebSocket,
        terminal_id: TerminalID,
    ) -> bool:
        """
        将 data 发送给 websocket。

        Returns:
            成功 True，失败 False
        """
        try:
            await websocket.send_bytes(data)
            return True
        except (WebSocketDisconnect, ConnectionClosed):
            return False
        except Exception:
            logging.exception("Failed to send bytes to websocket")
            return False


    async def _output_callback(
        self,
        data: bytes,
        terminal_id: TerminalID,
    ) -> None:
        """
        向与 ID 为 terminal_id 的 Terminal 相连的所有 WebSocket 发送输出流。
        """
        async with self._lock:
            ws_set = self._websockets.get(terminal_id)
            if ws_set is None:
                return
            targets = list(ws_set)

        # 广播消息
        tasks = [
            self._send_to_ws(data, websocket, terminal_id)
            for websocket in targets
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 剔除失败者
        dead = {ws for ws, ok in zip(targets, results) if ok is not True}
        if dead:
            async with self._lock:
                ws_set = self._websockets.get(terminal_id)
                if ws_set:
                    ws_set.difference_update(dead)


    def _get_websockets(self, terminal_id: TerminalID) -> Set[WebSocket]:
        """
        返回与 ID 为 terminal_id 的 Terminal 相连的所有 WebSocket。

        调用者需要持锁。

        Raises:
            TerminalNotFoundException: 如果没有找到目标 Terminal。
        """
        if terminal_id not in self._websockets:
            raise TerminalNotFoundException(terminal_id)
        return self._websockets[terminal_id]


    async def disconnect(
        self,
        terminal_id: TerminalID,
        websocket: WebSocket,
    ) -> None:
        """
        断开 websocket 与 ID 为 terminal_id 的 Terminal 的连接。

        Raises:
            TerminalNotFoundException: 如果没有找到目标 Terminal。
        """
        async with self._lock:
            ws_set = self._get_websockets(terminal_id)
            ws_set.discard(websocket)


    async def safe_disconnect(
        self,
        terminal_id: TerminalID,
        websocket: WebSocket
    ) -> None:
        """
        如果没有找到目标 Terminal，不会报错。
        """
        try:
            await self.disconnect(terminal_id, websocket)
        except TerminalNotFoundException:
            pass


    async def disconnect_all(
        self,
        terminal_id: TerminalID
    ) -> int:
        """
        断开所有与 ID 为 terminal_id 的 Terminal 相连的 WebSocket。

        执行此操作后，该 Terminal 将不能再次连接。

        Returns:
            断开连接的 WebSocket 的数量。

        Raises:
            TerminalNotFoundException: 如果没有找到目标 Terminal。
        """
        async with self._lock:
            ws_set = self._websockets.pop(terminal_id, None)

        if ws_set is None:
            raise TerminalNotFoundException(terminal_id)
        if ws_set:
            await asyncio.gather(
                map(self._safe_close, ws_set),
                return_exceptions=True,
            )
        return len(ws_set)


    async def register_outflow(
        self,
        terminal_id: TerminalID,
        websocket: WebSocket,
    ) -> None:
        """
        将 websocket 注册到 ID 为 terminal_id 的 Terminal 的输出广播列表。

        Raises:
            TerminalNotFoundException: 如果没有找到目标 Terminal。
        """
        async with self._lock:
            ws_set = self._get_websockets(terminal_id)
            ws_set.add(websocket)


    async def monitor_inflow(
        self,
        terminal_id: TerminalID,
        websocket: WebSocket,
    ) -> None:
        """
        监听 websocket 的输入，将输入发送给终端。
        """
        try:
            while True:
                data = await websocket.receive_bytes()
                async with self._lock:
                    ws_set = self._get_websockets(terminal_id)
                    if websocket not in ws_set:
                        raise WebSocketDisconnect()
                self.send(terminal_id, data)
        except (WebSocketDisconnect, ConnectionClosed):
            await self.safe_disconnect(terminal_id, websocket)
            return
        except TerminalNotFoundException:
            return
        except Exception as exp:
            # 兜底异常处理
            await self.safe_disconnect(terminal_id, websocket)
            raise exp


    async def serve(
        self,
        terminal_id: TerminalID,
        websocket: WebSocket,
    ) -> None:
        """
        自动处理 WebSocket 的整个生命周期：
        接受连接 -> 注册 -> 循环接收数据并转发给 Terminal -> 断开清理
        """
        try:
            await websocket.accept()

            # 发送历史记录（若失败则关闭连接）
            try:
                history = self._manager.get_history(terminal_id)
                ok = await self._send_to_ws(
                    data=history,
                    websocket=websocket,
                    terminal_id=terminal_id
                )
            except Exception as e:
                # 如果获取历史失败（如 Terminal 不存在），向客户端发送错误并关闭
                await websocket.close(code=1011, reason=f"Terminal error: {str(e)}")
                return

            if not ok:
                return

            # 注册到输出广播列表
            await self.register_outflow(terminal_id, websocket)

            # 循环监听输入
            await self.monitor_inflow(terminal_id, websocket)

        except WebSocketDisconnect:
            # 正常断开，无需特殊处理
            pass
        except Exception as e:
            # 其他异常，记录日志并尝试关闭连接
            logging.exception("Unexpected error in WebSocket serve")
            try:
                await websocket.close(code=1011, reason="Internal server error")
            except:
                pass
        finally:
            # 清理注册（如果还未清理）
            await self.safe_disconnect(terminal_id, websocket)
