"""
请求体格式。
"""

from typing import Dict, List, Optional, Union

from pydantic import Field

from ..schemas import BaseSchema


Real = Union[int, float]

class TerminalCreate(BaseSchema):
    """
    Terminal 的初始化参数。
    """

    terminal_id: Optional[str] = Field(
        description="要创建的终端的ID。",
        default=None
    )

    command: Optional[str] = Field(
        description="要在伪终端中执行的命令（完整路径或命令名）。默认使用 'bash'",
        default=None
    )

    args: Optional[List[str]] = Field(
        description="命令的参数列表。如果 `command` 已包含参数，可省略此参数。",
        default=None
    )

    cwd: Optional[str] = Field(
        description="新创建的 Terminal 的默认初始工作目录。默认为当前工作目录。",
        default=None
    )

    env: Optional[Dict[str, str | Real]] = Field(
        description="子进程的环境变量字典。默认继承父进程的环境变量。",
        default=None
    )

    dimensions: Optional[List[int]] = Field(
        description="伪终端的初始尺寸 `(rows, columns)`",
        min_length=2,
        max_length=2,
        default=None
    )

    idle_timeout: Optional[Real] = Field(
        description="当一个 Terminal 的“不活动”时长超过这个值时，认为该 Terminal 过期了。（单位：秒）",
        ge=1,
        default=None
    )
