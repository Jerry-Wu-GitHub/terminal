import time

from ..terminal import TerminalManager, TerminalID



async def output_callback(data: bytes, terminal_id: TerminalID) -> None:
    print(f"[{terminal_id}]输出：{data}")


def main():
    print("[TerminalManager] 开始测试")
    manager = TerminalManager(output_callback=output_callback)
    tid1 = manager.create(terminal_id="terminal1")
    tid2 = manager.create()
    manager.send(tid1, "ls\n")
    manager.send(tid2, "ls\n")
    manager.send(tid1, """python -c "import time; time.sleep(3); print('get up')"\n""".encode())
    time.sleep(2)
    print(f"session2.history={manager.get_history(tid2)}")
    time.sleep(2)
    print("[TerminalManager] 测试完成")


if __name__ == '__main__':
    main()
