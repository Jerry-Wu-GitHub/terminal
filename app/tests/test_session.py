import time
from typing import Awaitable, Callable

from ..terminal import TerminalSession


def get_output_callback(name: str) -> Callable[[bytes], Awaitable[None]]:
    async def output_callback(data: bytes) -> None:
        print(f"{name}输出：{data}")
    return output_callback


def main():
    print("[TerminalSession] 开始测试")
    with TerminalSession(output_callback=get_output_callback("terminal1")) as terminal1:
        with TerminalSession(output_callback=get_output_callback("terminal2")) as terminal2:
            terminal1.send("l".encode())
            terminal1.send("s".encode())
            terminal1.send("\n".encode())
            terminal1.send("""python -c "import time; time.sleep(3); print('get up')"\n""".encode())
            terminal2.send("l".encode())
            terminal2.send("s".encode())
            terminal2.send("\n".encode())
            time.sleep(2)
            print(f"{terminal2.history=}")
            time.sleep(2)
    print("[TerminalSession] 测试完成")


if __name__ == '__main__':
    main()
