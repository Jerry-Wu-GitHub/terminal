from typing import Dict, Callable
from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette import status

from .exceptions import BusinessException
from .routers.api.schemas import ErrorResponse


async def business_exception_handler(
    request: Request,
    exc: BusinessException
) -> JSONResponse:
    """
    处理业务异常。
    """
    resp = ErrorResponse(
        code=exc.code,
        message=exc.message,
        details=exc.details,
        request_id=str(uuid4()),  # 自动生成追踪ID
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=resp.model_dump(by_alias=True, exclude_none=True)
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError
) -> JSONResponse:
    """
    请求参数验证失败。
    """
    errors = [
        {
            "field": ".".join(map(str, err["loc"][1:])),
            "message": err["msg"]
        }
        for err in exc.errors()
    ]
    resp = ErrorResponse(
        code="INVALID_PARAMETER",
        message="Parameter verification failed.",
        details={"fields": errors},
        request_id=str(uuid4()),
    )
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=resp.model_dump(by_alias=True, exclude_none=True)
    )


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    兜底所有未预料到的异常，只做最安全的序列化
    """
    resp = ErrorResponse(
        code="INTERNAL_SERVER_ERROR",
        message="Internal server error.",
        request_id=getattr(request.state, "request_id", "")
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=resp.model_dump(by_alias=True, exclude_none=True)
    )


# 异常与处理函数的映射
EXCEPTION_HANDLER_MAPPING: Dict[type(Exception), Callable[[Request, Exception], Response]] = {
    BusinessException: business_exception_handler,
    RequestValidationError: validation_exception_handler,
    Exception: global_exception_handler,
}
