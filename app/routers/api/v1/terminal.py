from typing import List

from fastapi import APIRouter, WebSocket
from starlette import status

from ....common import get_terminal_ws_connector
from ..schemas import ApiResponse
from .request_schemas import TerminalCreate
from .response_schemas import TerminalInfo


router = APIRouter(prefix="/terminals", tags=["Terminal API"])
terminal_ws_connector = get_terminal_ws_connector()


@router.get("/", status_code=status.HTTP_200_OK)
async def get_all_terminal_info() -> ApiResponse[List[TerminalInfo]]:
    """
    查询所有的 Terminal 的信息。
    """
    data = await terminal_ws_connector.get_all_terminal_info()
    return ApiResponse(data=data)


@router.get("/{terminal_id}", status_code=status.HTTP_200_OK)
async def get_terminal_info(
    terminal_id: str,
) -> ApiResponse[TerminalInfo]:
    """
    查询一个 Terminal 的信息。
    """
    data = await terminal_ws_connector.get_terminal_info(terminal_id)
    return ApiResponse(data=data)


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_terminal(
    terminal_create_params: TerminalCreate
) -> ApiResponse[TerminalInfo]:
    """
    创建一个新的 Terminal。
    """
    terminal_id = await terminal_ws_connector.create_terminal(
        terminal_id=terminal_create_params.terminal_id,
        command=terminal_create_params.command,
        args=terminal_create_params.args,
        cwd=terminal_create_params.cwd,
        env=terminal_create_params.env,
        dimensions=terminal_create_params.dimensions,
        idle_timeout=terminal_create_params.idle_timeout,
    )
    data = await terminal_ws_connector.get_terminal_info(terminal_id)
    return ApiResponse(data=data)


@router.delete("/{terminal_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.post("/{terminal_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_terminal(
    terminal_id: str,
) -> None:
    """
    关闭一个 Terminal 实例，并断开与它连接的所有 WebSockets。
    """
    await terminal_ws_connector.delete_terminal(terminal_id)


@router.websocket("/{terminal_id}")
async def terminal_websocket_connect(
    terminal_id: str,
    websocket: WebSocket
):
    """
    与 ID 为 terminal_id 的 Terminal 建立 WS 连接。

    连接建立后，后端会先向前端发送一段字节流，这是该 Terminal 的历史记录。

    之后，前后两端的通信是双工且异步的。前端直接发送字节流到后端，后端也会直接发送字节流到前端。
    """
    await terminal_ws_connector.serve(
        terminal_id=terminal_id,
        websocket=websocket,
    )
