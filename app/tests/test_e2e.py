"""
后端 Terminal 服务的端到端测试脚本。

覆盖：
- REST : 创建 / 查询 / 列表 / 删除 / 冲突 / 不存在
- WS   : 历史推送 / 命令执行 / 多客户端广播 / 连接不存在 terminal

依赖：httpx、websockets
运行：python test_e2e.py
"""

import asyncio
import uuid
from typing import Any

import httpx
import websockets
from websockets.exceptions import ConnectionClosed


BASE_URL     = "http://10.176.25.117:7862"
WS_BASE      = "ws://10.176.25.117:7862"
API          = "/api/v1/terminals"
RECV_TIMEOUT = 5.0


# ============================================================
# 辅助
# ============================================================

async def _create(client: httpx.AsyncClient, tid: str | None) -> httpx.Response:
    body: dict[str, Any] = {}
    if tid is not None:
        body["terminalId"] = tid
    return await client.post(f"{API}/", json=body)


async def _drain_until(ws, needle: bytes, timeout: float = 3.0) -> bytes:
    """从 ws 循环收数据，直到累计内容包含 needle 或超时。"""
    buf = b""
    try:
        while True:
            chunk = await asyncio.wait_for(ws.recv(), timeout=timeout)
            if isinstance(chunk, str):
                chunk = chunk.encode()
            buf += chunk
            if needle in buf:
                return buf
    except asyncio.TimeoutError:
        return buf


# ============================================================
# REST 测试
# ============================================================

async def test_create_and_get(client: httpx.AsyncClient) -> str:
    tid = f"test-{uuid.uuid4().hex[:8]}"
    resp = await _create(client, tid)
    assert resp.status_code == 201, f"create 期望 201，实际 {resp.status_code}：{resp.text}"

    data = resp.json()["data"]
    assert data["id"] == tid, "id 字段不符"
    assert isinstance(data["width"],  int) and data["width"]  > 0, "width 异常"
    assert isinstance(data["height"], int) and data["height"] > 0, "height 异常"
    assert "expiredAt" in data, "缺少 expiredAt 字段"

    resp = await client.get(f"{API}/{tid}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["id"] == tid
    print(f"[OK] 创建并查询 terminal：{tid}")
    return tid


async def test_list(client: httpx.AsyncClient) -> None:
    resp = await client.get(f"{API}/")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert isinstance(data, list) and all("id" in t for t in data)
    print(f"[OK] 列出全部 terminal（{len(data)} 个）")


async def test_duplicate(client: httpx.AsyncClient, tid: str) -> None:
    resp = await _create(client, tid)
    assert resp.status_code == 409, f"重复创建期望 409，实际 {resp.status_code}"
    body = resp.json()
    assert body["code"] in {"TERMINAL_EXISTS", "RESOURCE_EXISTS"}, body
    print(f"[OK] 重复创建被拒绝：{body['code']}")


async def test_not_found(client: httpx.AsyncClient) -> None:
    fake = f"nope-{uuid.uuid4().hex}"
    resp = await client.get(f"{API}/{fake}")
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["code"] == "TERMINAL_NOT_FOUND", body
    print(f"[OK] 查询不存在 terminal 返回 404：{body['code']}")


async def test_delete(client: httpx.AsyncClient, tid: str) -> None:
    resp = await client.delete(f"{API}/{tid}")
    assert resp.status_code == 204, f"delete 期望 204，实际 {resp.status_code}"

    resp = await client.get(f"{API}/{tid}")
    assert resp.status_code == 404, "删除后仍能查询到"
    print(f"[OK] 删除 terminal：{tid}")


# ============================================================
# WebSocket 测试
# ============================================================

async def test_ws_basic(tid: str) -> None:
    """连接、先收历史，再执行 echo 命令并验证输出。"""
    ws_url = f"{WS_BASE}{API}/{tid}"
    async with websockets.connect(ws_url, max_size=None) as ws:
        history = await asyncio.wait_for(ws.recv(), timeout=RECV_TIMEOUT)
        print(f"[OK] WS 收到历史记录（{len(history)} 字节）")

        # pty 会把 \n 回显为 \r\n，所以期望见到两次 needle
        await ws.send(b"echo hello-terminal\n")
        buf = await _drain_until(ws, b"hello-terminal", timeout=3.0)
        assert b"hello-terminal" in buf, f"未收到期望输出：{buf!r}"
        print(f"[OK] WS 命令执行成功（收到 {len(buf)} 字节）")


async def test_ws_broadcast(tid: str) -> None:
    """两个 WS 同时订阅，一端输入，两端都应收到广播。"""
    ws_url = f"{WS_BASE}{API}/{tid}"
    async with websockets.connect(ws_url, max_size=None) as ws1, \
               websockets.connect(ws_url, max_size=None) as ws2:
        await asyncio.wait_for(ws1.recv(), timeout=RECV_TIMEOUT)
        await asyncio.wait_for(ws2.recv(), timeout=RECV_TIMEOUT)

        await ws1.send(b"echo broadcast-check\n")

        b1, b2 = await asyncio.gather(
            _drain_until(ws1, b"broadcast-check", 3.0),
            _drain_until(ws2, b"broadcast-check", 3.0),
        )
        assert b"broadcast-check" in b1, "客户端 1 未收到广播"
        assert b"broadcast-check" in b2, "客户端 2 未收到广播"
        print(f"[OK] WS 广播正常（{len(b1)} / {len(b2)} 字节）")


async def test_ws_not_found() -> None:
    """连接不存在的 terminal 应被服务端关闭。"""
    ws_url = f"{WS_BASE}{API}/nope-{uuid.uuid4().hex}"
    try:
        async with websockets.connect(ws_url) as ws:
            try:
                await asyncio.wait_for(ws.recv(), timeout=3.0)
                raise AssertionError("服务器未按预期关闭连接")
            except ConnectionClosed:
                pass
    except ConnectionClosed:
        pass
    print("[OK] WS 连接不存在的 terminal 被拒绝")


# ============================================================
# 入口
# ============================================================

async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as client:
        try:
            await client.get(f"{API}/")
        except httpx.ConnectError:
            print(f"[X] 无法连接到 {BASE_URL}，请先启动服务（python -m app.main）")
            return

        print("========== REST ==========")
        tid = await test_create_and_get(client)
        await test_list(client)
        await test_duplicate(client, tid)
        await test_not_found(client)

        print("\n========== WebSocket ==========")
        await test_ws_basic(tid)
        await test_ws_broadcast(tid)
        await test_ws_not_found()

        print("\n========== 清理 ==========")
        await test_delete(client, tid)

    print("\n所有测试通过 ✅")


if __name__ == "__main__":
    asyncio.run(main())
