"""
统一业务异常类。
"""

from __future__ import annotations

from typing import Any, ClassVar, Dict, Optional

from starlette import status


class BusinessException(Exception):
    """
    业务异常基类，所有业务错误都继承自这里。
    
    Attributes:
        code: 错误代码
        message: 错误消息
        details: 附加详情（可选）
    """

    # 默认响应码
    DEFAULT_STATUS_CODE : ClassVar[int] = status.HTTP_500_INTERNAL_SERVER_ERROR

    # 默认消息
    DEFAULT_MESSAGE     : ClassVar[str] = "Business Error"

    # 默认错误代码
    DEFAULT_CODE        : ClassVar[str] = "ERROR"

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message    : str = self.DEFAULT_MESSAGE     if (message     is None) else message
        self.status_code: int = self.DEFAULT_STATUS_CODE if (status_code is None) else status_code
        self.code       : str = self.DEFAULT_CODE        if (code        is None) else code
        self.details    : Dict[str, Any] = details or {}

        super().__init__(self.message)


class ResourceNotFoundException(BusinessException):
    """
    资源不存在
    """
    DEFAULT_STATUS_CODE = status.HTTP_404_NOT_FOUND
    DEFAULT_MESSAGE     = "The requested resource does not exist."
    DEFAULT_CODE        = "RESOURCE_NOT_FOUND"

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        **kwargs
    ):
        if resource_id is not None:
            details = details or {}
            details["resource_id"] = resource_id
        super().__init__(
            message=message,
            details=details,
            **kwargs
        )


class TerminalNotFoundException(ResourceNotFoundException):
    """未找到指定的 Terminal"""
    DEFAULT_MESSAGE = "The requested shell does not exist."
    DEFAULT_CODE    = "TERMINAL_NOT_FOUND"


class ResourceExistsException(BusinessException):
    """
    资源已存在
    """
    DEFAULT_STATUS_CODE = status.HTTP_409_CONFLICT
    DEFAULT_MESSAGE     = "The requested resource already exists."
    DEFAULT_CODE        = "RESOURCE_EXISTS"

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        **kwargs
    ):
        if resource_id is not None:
            details = details or {}
            details["resource_id"] = resource_id
        super().__init__(
            message=message,
            details=details,
            **kwargs
        )


class TerminalExistsException(ResourceExistsException):
    """未找到指定的 Terminal"""
    DEFAULT_MESSAGE = "The requested terminal does not exist."
    DEFAULT_CODE    = "TERMINAL_EXISTS"
