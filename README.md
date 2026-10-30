---
domain: #领域
tags: #自定义标签
-
datasets: #关联数据集
  evaluation:
  test:
  train:
models: #关联模型

## 启动文件
# deployspec:
#   entry_file: main.py
license: Apache License 2.0
---

# 网络终端

## 介绍

这是一个基于 Python FastAPI 后端框架实现的交互式终端，默认启动 `bash`，使用体验与 SSH 客户端类似。

可部署在仅允许 HTTP GET/POST 请求和 WebSocket 连接的环境中。

主要通信原理：

- 前端拦截大部分按键和输入，将其转换为终端输入字节流，通过 WebSocket 发送到后端。
- 后端将收到的输入写入 PTY，由 PTY 中运行的 shell 或前台进程处理。
- 后端实时读取 PTY 输出，并通过 WebSocket 广播给所有订阅该终端的前端。

## 快速开始

1. 克隆仓库

    ```bash
    git clone https://www.modelscope.cn/studios/JerryWuModelScope/terminal.git
    ```

2. 安装依赖

    ```bash
    cd terminal
    python -m pip install -r requirements.txt
    ```

3. 启动应用

    ```bash
    python main.py
    ```

应用默认运行在 `0.0.0.0:7860` ，可以通过环境变量配置。

## 添加为子页面

可以将本网络终端添加为您的已有的网络应用的子页面。

1. 在入口文件的包搜索路径里，将本仓库作为项目子模块

    ```bash
    git submodule add https://www.modelscope.cn/studios/JerryWuModelScope/terminal.git terminal
    git submodule update --remote
    ```

2. 安装依赖

    ```bash
    python -m pip install -r "terminal/requirements.txt"
    ```

3. 在您的 FastAPI 应用创建处：

    ```python
    from terminal import (
        get_router as get_terminal_router,
    	lifespan as terminal_lifespan,
    	EXCEPTION_HANDLER_MAPPING as TERMINAL_EXCEPTION_HANDLER_MAPPING,
    )
    
    # 创建 FastAPI 应用
    app = FastAPI(title="Your APP", lifespan=terminal_lifespan)
    
    # 添加路由
    app.include_router(get_terminal_router(prefix="/terminal"))
    
    # 注册异常处理
    for exp, handler in TERMINAL_EXCEPTION_HANDLER_MAPPING.items():
        app.add_exception_handler(exp, handler)
    ```

如果指定了前缀（如 `get_router(prefix="/terminal")`），那么该子页面的所有请求（包括对静态资源的）都会带上该前缀。

## 环境变量

应用启动时会调用 `load_dotenv()`，因此也可以通过项目根目录下的 `.env` 文件配置。环境变量未设置或为空字符串时使用默认值；`PORT` 等需要类型转换的变量若转换失败，也会回退到默认值。

| 环境变量     | 说明                        | 默认值                            |
| ------------ | --------------------------- | --------------------------------- |
| `BASE_DIR`   | Terminal 根目录             | 本仓库根目录                      |
| `STATIC_DIR` | Terminal 静态资源目录       | `"${BASE_DIR}/static"`            |
| `INDEX_PATH` | Terminal 首页 HTML 文件路径 | `"${STATIC_DIR}/html/index.html"` |
| `HOST`       | 服务监听主机                | `"0.0.0.0"`                       |
| `PORT`       | 服务监听端口                | `7860`                            |

- `HOST` 和 `PORT` 仅在启动本仓库根目录里的 `main.py` 时才有效。
