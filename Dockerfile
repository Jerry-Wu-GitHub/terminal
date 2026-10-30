FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.12

# 避免 apt 安装时出现交互式提示
ENV DEBIAN_FRONTEND=noninteractive

# ============================================================
# 系统工具层：放在 COPY 之前，改代码不会触发这一层重建
# ============================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
      # 基础运维 / 排查
      iproute2 lsof net-tools psmisc procps iputils-ping \
      curl wget ca-certificates dnsutils netcat-openbsd tcpdump \
      inetutils-telnet whois sshpass \
      # 系统监控
      htop sysstat iotop ncdu tmux screen less \
      # 文本 / 数据 / 开发辅助
      vim jq ripgrep fzf git \
      tree fd-find unzip bzip2 \
      # 编译工具（requirements 全部命中 wheel 时可移除）
      build-essential \
    && rm -rf /var/lib/apt/lists/* \
    # Debian/Ubuntu 的 fd-find 命令名是 fdfind，补一个 fd 软链
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd

# ============================================================
# 可选：Node.js / npm
# 仅在运行期确实需要 node/npm 时保留；否则整层删除。
# 如果只是构建期用 Node，建议改成多阶段构建，不要进最终镜像。
# ============================================================
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/user/app
COPY ./ /home/user/app
RUN pip install -r "requirements.txt"
ENTRYPOINT ["python", "-u", "main.py"]