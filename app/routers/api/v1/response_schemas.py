"""
响应体数据格式。
"""

from __future__ import annotations

from pydantic import Field

from ..schemas import BaseSchema


class TerminalInfo(BaseSchema):
    """
    Terminal 的信息
    """
    id: str = Field(
        description="该 Terminal 的唯一标识。"
    )

    width: int = Field(
        description="该 Terminal 的宽度（单位：字符）。"
    )

    height: int = Field(
        description="该 Terminal 的高度（单位：字符）。"
    )

    expired_at: float | int = Field(
        description="该 Terminal 的过期时间戳（单位：秒）。"
    )
