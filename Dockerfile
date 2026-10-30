FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.12

# 避免 apt 安装时出现交互式提示
ENV DEBIAN_FRONTEND=noninteractive

# 安装系统工具：放在 COPY 之前，改代码不会触发这一层重建
RUN apt-get update && apt-get install -y --no-install-recommends \
      # 基础运维 / 排查
      iproute2 lsof net-tools psmisc procps iputils-ping \
      curl wget ca-certificates dnsutils netcat-openbsd tcpdump \
      # 系统监控
      htop sysstat iotop ncdu tmux less \
      # 文本 / 数据 / 开发辅助
      vim jq ripgrep fzf git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user/app
COPY ./ /home/user/app
RUN pip install -r "requirements.txt"
ENTRYPOINT ["python", "-u", "main.py"]