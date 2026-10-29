"""
公共对象。
"""

from functools import lru_cache

from .config import Config
from .terminal import TerminalWSConnector


@lru_cache(maxsize=1)
def get_config() -> Config:
    """
    获取全局唯一的 Config 单例对象。
    """
    return Config()


@lru_cache(maxsize=1)
def get_terminal_ws_connector() -> TerminalWSConnector:
    """
    获取全局唯一的 TerminalWSConnector 单例对象。
    """
    return TerminalWSConnector()
