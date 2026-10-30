import asyncio
import contextlib
import logging
from typing import AsyncIterator

from .common import get_config, get_terminal_ws_connector
from .exception_handlers import EXCEPTION_HANDLER_MAPPING
from .routers import get_router


async def _cleanup_expired_loop(interval: float) -> None:
    """
    定时调用全局 TerminalWSConnector 的 clean_up_expired 方法。
    """
    connector = get_terminal_ws_connector()
    while True:
        await asyncio.sleep(interval)
        try:
            await connector.clean_up_expired()
        except asyncio.CancelledError:
            raise
        except Exception:
            # 单次清理失败不应终止定时任务
            logging.exception("Failed to clean up expired resources")


@contextlib.asynccontextmanager
async def lifespan(app) -> AsyncIterator[None]:
    """
    FastAPI 生命周期管理：启动时创建定时清理任务，关闭时取消该任务。
    """
    interval = get_terminal_ws_connector().cleanup_interval
    task = asyncio.create_task(_cleanup_expired_loop(interval))
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


__all__ = ["get_config", "get_router", "lifespan", "EXCEPTION_HANDLER_MAPPING"]
