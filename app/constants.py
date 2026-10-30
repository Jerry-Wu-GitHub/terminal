"""
应用级常量。
"""

from pathlib import Path
from typing import Optional


# 项目根目录
DEFAULT_BASE_DIR: Path = Path(__file__).resolve().parent.parent

# 静态资源目录
DEFAULT_STATIC_DIR: Path = DEFAULT_BASE_DIR / "static"
DEFAULT_HTML_DIR: Path = DEFAULT_STATIC_DIR / "html"
DEFAULT_INDEX_PATH: Path = DEFAULT_HTML_DIR / "index.html"

# 服务监听配置
DEFAULT_HOST: str = "0.0.0.0"
DEFAULT_PORT: int = 7860

# 终端配置
DEFAULT_TERMINAL_INIT_CWD: Optional[str] = None
