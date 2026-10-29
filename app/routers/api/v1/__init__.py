"""
路由聚合模块。
"""

from fastapi import APIRouter

from ._common import API_VERSION
from .terminal import router as terminal_router

# 为所有 API 添加统一前缀 /v1
router = APIRouter(prefix=f"/{API_VERSION}")
router.include_router(terminal_router)

__all__ = ["router"]
