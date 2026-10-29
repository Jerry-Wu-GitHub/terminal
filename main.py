"""
应用入口文件，创建 FastAPI 实例，挂载路由，启动服务。
"""

from fastapi import FastAPI
import uvicorn

from app import get_config, get_router, EXCEPTION_HANDLER_MAPPING


# 创建 FastAPI 应用
app = FastAPI(title="Terminal")

# 添加路由
app.include_router(get_router())

# 注册异常处理
for exp, handler in EXCEPTION_HANDLER_MAPPING.items():
    app.add_exception_handler(exp, handler)


if __name__ == "__main__":
    config = get_config()
    uvicorn.run(app, host=config.host, port=config.port)
