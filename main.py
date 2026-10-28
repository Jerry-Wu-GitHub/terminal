"""
应用入口文件，创建 FastAPI 实例，挂载路由，启动服务。
"""

from fastapi import FastAPI
import uvicorn

from app.config import HOST, PORT
from app.exception_handlers import EXCEPTION_HANDLER_MAPPING
from app.routes import get_router


# 创建 FastAPI 应用
app = FastAPI(title="Terminal")

# 添加路由
app.include_router(get_router())

# 注册异常处理
for exp, handler in EXCEPTION_HANDLER_MAPPING.items():
    app.add_exception_handler(exp, handler)


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
