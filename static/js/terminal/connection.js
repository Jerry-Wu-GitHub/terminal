/**
 * Terminal WebSocket 连接封装。
 *
 * 负责建立/关闭连接、把二进制消息交给回调，并用 generation 机制忽略
 * 旧连接的迟到事件，避免快速切换 Terminal 时串台。
 */

import { buildTerminalWebSocketUrl } from "../api/terminals.js";

/**
 * 管理单条 WebSocket 连接。
 */
export class TerminalConnection {
  /**
   * @param {{onOpen: Function, onData: Function, onClose: Function}} handlers 事件回调。
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.socket = null;
    this.generation = 0;
    this.intentionalClose = false;
    this.encoder = new TextEncoder();
  }

  /**
   * 连接到指定 Terminal。
   *
   * @param {string} terminalId Terminal ID。
   */
  open(terminalId) {
    this.close();
    const generation = this.generation + 1;
    this.generation = generation;
    this.intentionalClose = false;

    const socket = new WebSocket(buildTerminalWebSocketUrl(terminalId));
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (generation !== this.generation) {
        return;
      }
      this.handlers.onOpen(terminalId);
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event, generation);
    });

    socket.addEventListener("close", (event) => {
      if (generation !== this.generation) {
        return;
      }
      this.socket = null;
      this.handlers.onClose({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        intentional: this.intentionalClose,
      });
    });

    socket.addEventListener("error", () => {
      // 浏览器随后会触发 close 事件，由 close 统一处理。
    });
  }

  /**
   * 处理一条 WebSocket 消息。
   *
   * @param {MessageEvent} event 消息事件。
   * @param {number} generation 连接代号。
   * @returns {Promise<void>} 处理完成。
   */
  async handleMessage(event, generation) {
    let bytes = null;
    if (event.data instanceof ArrayBuffer) {
      bytes = new Uint8Array(event.data);
    } else if (typeof event.data === "string") {
      bytes = this.encoder.encode(event.data);
    } else if (event.data instanceof Blob) {
      try {
        bytes = new Uint8Array(await event.data.arrayBuffer());
      } catch (error) {
        return;
      }
    }

    if (!bytes || generation !== this.generation) {
      return;
    }
    try {
      this.handlers.onData(bytes);
    } catch (error) {
      console.error("处理 Terminal 输出失败：", error);
    }
  }

  /**
   * 向终端发送字节。
   *
   * @param {Uint8Array} bytes 要发送的字节。
   * @returns {boolean} 是否成功发送。
   */
  send(bytes) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.socket.send(bytes);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 主动关闭连接，并让旧连接的所有事件失效。 */
  close() {
    const socket = this.socket;
    this.intentionalClose = true;
    this.generation += 1;
    this.socket = null;
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        socket.close(1000, "Client disconnected");
      } catch (error) {
        // 连接尚未完成时关闭可能抛出异常，忽略即可。
      }
    }
  }
}
