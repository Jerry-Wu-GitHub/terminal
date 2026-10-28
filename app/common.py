"""
公共对象。
"""

from functools import lru_cache

from .terminal import TerminalWSConnector



@lru_cache(maxsize=1)
def get_terminal_ws_connector() -> TerminalWSConnector:
    """获取全局唯一的 TerminalWSConnector 对象。

    Returns:
        全局 TerminalWSConnector 对象单例。
    """
    return TerminalWSConnector()
