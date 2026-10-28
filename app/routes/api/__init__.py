"""
路由聚合模块。
"""

from fastapi import APIRouter

from .v1 import (
	router as v1_router,
	API_VERSION as API_VERSION_V1
)

# 为所有 API 添加统一前缀 /api
router = APIRouter(prefix="/api")
router.include_router(v1_router)

LATEST_VERSION = API_VERSION_V1

__all__ = ["router", "LATEST_VERSION"]
