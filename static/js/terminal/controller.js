/**
 * 终端会话控制器。
 *
 * 把顶部操作栏、REST 接口、WebSocket 连接、ANSI 解析器和渲染器串联
 * 起来，负责新建、连接、断开、删除、轮询过期时间以及错误提示。
 */

import { ApiError } from "../api/client.js";
import {
  createTerminal,
  deleteTerminal,
  getTerminal,
} from "../api/terminals.js";
import { POLL_INTERVAL_MILLISECONDS } from "../config.js";
import { playBell } from "./bell.js";
import { TerminalConnection } from "./connection.js";
import { AnsiParser } from "./parser.js";
import { Topbar } from "../ui/topbar.js";

/**
 * 把服务端关闭原因整理为可读文案。
 *
 * @param {string} reason 关闭原因。
 * @returns {string} 可读文案。
 */
function formatCloseReason(reason) {
  if (!reason) {
    return "服务器结束了连接";
  }
  const prefix = "Terminal error: ";
  if (reason.startsWith(prefix)) {
    return reason.slice(prefix.length);
  }
  return reason;
}

/**
 * 终端会话控制器。
 */
export class TerminalController {
  /**
   * @param {Object} options 依赖项。
   * @param {Object} options.screen TerminalScreen 实例。
   * @param {Object} options.renderer TerminalRenderer 实例。
   * @param {Function} options.showInfo 信息提示函数。
   * @param {Function} options.showError 错误提示函数。
   * @param {Function} options.showSuccess 成功提示函数。
   */
  constructor({ screen, renderer, showInfo, showError, showSuccess }) {
    this.screen = screen;
    this.renderer = renderer;
    this.showInfo = showInfo;
    this.showError = showError;
    this.showSuccess = showSuccess;

    this.parser = new AnsiParser(screen, { onBell: playBell });
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder("utf-8");
    this.connection = new TerminalConnection({
      onOpen: (terminalId) => this.handleConnectionOpen(terminalId),
      onData: (bytes) => this.handleData(bytes),
      onClose: (event) => this.handleConnectionClose(event),
    });

    this.topbar = new Topbar({
      onCreate: () => this.createNewTerminal(),
      onConnect: (terminalId) => this.connectToTerminal(terminalId),
      onDisconnect: () => this.disconnect(),
      onClose: () => this.destroyTerminal(),
    });

    this.terminalId = null;
    this.expiry = null;
    this.busy = null;
    this.pendingInfo = null;
    this.pollTimer = null;
    this.pollInFlight = false;
    this.updateTopbar();
  }

  /** 当前是否已建立连接。 */
  get isConnected() {
    return this.terminalId !== null;
  }

  /** 刷新顶部操作栏。 */
  updateTopbar() {
    this.topbar.update({
      connectedId: this.terminalId,
      expiry: this.expiry,
      busy: this.busy,
    });
  }

  /**
   * 根据 Terminal 信息重置屏幕。
   *
   * @param {{width: number, height: number}} info Terminal 信息。
   */
  prepareScreen(info) {
    this.parser.reset();
    this.decoder = new TextDecoder("utf-8");
    this.screen.reset(info.width, info.height);
    this.screen.cursorVisible = false;
    this.renderer.resetView();
    this.renderer.sync(this.screen);
  }

  /** 新建一个 Terminal 并连接。 */
  async createNewTerminal() {
    if (this.busy !== null) {
      return;
    }
    this.connection.close();
    this.stopPolling();
    this.terminalId = null;
    this.expiry = null;
    this.pendingInfo = null;
    this.busy = "creating";
    this.screen.cursorVisible = false;
    this.renderer.sync(this.screen);
    this.updateTopbar();

    try {
      const info = await createTerminal();
      this.pendingInfo = info;
      this.topbar.setInputValue(info.id);
      this.prepareScreen(info);
      this.busy = "connecting";
      this.updateTopbar();
      this.connection.open(info.id);
    } catch (error) {
      this.busy = null;
      this.pendingInfo = null;
      this.updateTopbar();
      this.showError(error);
      this.topbar.focusInput();
    }
  }

  /**
   * 连接到指定 Terminal。
   *
   * @param {string} terminalId Terminal ID。
   */
  async connectToTerminal(terminalId) {
    if (this.busy !== null) {
      return;
    }
    const targetId = terminalId.trim();
    if (targetId === "" || targetId === this.terminalId) {
      return;
    }
    this.topbar.setInputValue(targetId);

    this.connection.close();
    this.stopPolling();
    this.terminalId = null;
    this.expiry = null;
    this.pendingInfo = null;
    this.busy = "connecting";
    this.screen.cursorVisible = false;
    this.renderer.sync(this.screen);
    this.updateTopbar();

    try {
      const info = await getTerminal(targetId);
      this.pendingInfo = info;
      this.prepareScreen(info);
      this.connection.open(targetId);
    } catch (error) {
      this.busy = null;
      this.pendingInfo = null;
      this.updateTopbar();
      this.showError(error);
      this.topbar.focusInput();
    }
  }

  /** 断开当前 WebSocket，但保留服务端 Terminal。 */
  disconnect() {
    if (this.terminalId === null || this.busy !== null) {
      return;
    }
    const terminalId = this.terminalId;
    this.connection.close();
    this.stopPolling();
    this.terminalId = null;
    this.expiry = null;
    this.pendingInfo = null;
    this.busy = null;
    this.screen.cursorVisible = false;
    this.updateTopbar();
    if (this.topbar.getInputValue().trim() === terminalId) {
      this.topbar.setInputValue("");
    }
    this.renderer.sync(this.screen);
    this.showInfo("已断开与 Terminal 的连接");
    this.topbar.focusInput();
  }

  /** 断开并删除当前 Terminal。 */
  async destroyTerminal() {
    if (this.terminalId === null || this.busy !== null) {
      return;
    }
    const terminalId = this.terminalId;
    this.busy = "deleting";
    this.updateTopbar();
    this.connection.close();
    this.stopPolling();

    let failure = null;
    try {
      await deleteTerminal(terminalId);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        failure = error;
      }
    }

    this.terminalId = null;
    this.expiry = null;
    this.pendingInfo = null;
    this.busy = null;
    this.screen.cursorVisible = false;
    this.updateTopbar();
    if (this.topbar.getInputValue().trim() === terminalId) {
      this.topbar.setInputValue("");
    }
    this.renderer.sync(this.screen);

    if (failure) {
      this.showError(failure);
    } else {
      this.showSuccess("Terminal 已关闭");
    }
    this.topbar.focusInput();
  }

  /**
   * WebSocket 打开后的处理。
   *
   * @param {string} terminalId 已连接的 Terminal ID。
   */
  handleConnectionOpen(terminalId) {
    this.terminalId = terminalId;
    this.expiry = this.pendingInfo ? this.pendingInfo.expiredAt : null;
    this.pendingInfo = null;
    this.busy = null;
    this.screen.cursorVisible = true;
    this.renderer.resetView();
    this.renderer.sync(this.screen);
    this.updateTopbar();
    this.startPolling();
    this.focusTerminal();
  }

  /**
   * WebSocket 关闭后的处理。
   *
   * @param {{code: number, reason: string, wasClean: boolean, intentional: boolean}} event 关闭事件。
   */
  handleConnectionClose(event) {
    this.stopPolling();
    this.terminalId = null;
    this.expiry = null;
    this.pendingInfo = null;
    this.busy = null;
    this.screen.cursorVisible = false;
    this.renderer.sync(this.screen);
    this.updateTopbar();
    this.topbar.focusInput();

    if (event.intentional) {
      return;
    }
    if (event.code === 1011) {
      this.showError(`连接异常：${formatCloseReason(event.reason)}`);
    } else if (event.wasClean || event.code === 1000 || event.code === 1001) {
      this.showInfo("Terminal 连接已关闭");
    } else {
      this.showError(`连接异常关闭（代码 ${event.code}）`);
    }
  }

  /**
   * 处理 WebSocket 传来的字节流。
   *
   * @param {Uint8Array} bytes 字节流。
   */
  handleData(bytes) {
    if (this.terminalId === null || bytes.length === 0) {
      return;
    }
    const text = this.decoder.decode(bytes, { stream: true });
    if (text === "") {
      return;
    }
    this.parser.write(text);
    this.renderer.sync(this.screen);
  }

  /** 开始轮询当前 Terminal 的信息。 */
  startPolling() {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      this.pollTerminalInfo();
    }, POLL_INTERVAL_MILLISECONDS);
  }

  /** 停止轮询。 */
  stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 轮询当前 Terminal 的信息并更新过期时间。 */
  async pollTerminalInfo() {
    if (
      this.pollInFlight ||
      this.terminalId === null ||
      this.busy !== null
    ) {
      return;
    }
    const terminalId = this.terminalId;
    this.pollInFlight = true;
    try {
      const info = await getTerminal(terminalId);
      if (this.terminalId === terminalId && this.busy === null) {
        this.expiry = info.expiredAt;
        this.updateTopbar();
      }
    } catch (error) {
      if (
        this.busy === null &&
        error instanceof ApiError &&
        error.status === 404 &&
        this.terminalId === terminalId
      ) {
        this.stopPolling();
        this.connection.close();
        this.terminalId = null;
        this.expiry = null;
        this.pendingInfo = null;
        this.busy = null;
        this.screen.cursorVisible = false;
        this.updateTopbar();
        if (this.topbar.getInputValue().trim() === terminalId) {
          this.topbar.setInputValue("");
        }
        this.renderer.sync(this.screen);
        this.showError("Terminal 已不存在或已过期");
        this.topbar.focusInput();
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  /**
   * 发送键盘输入的文本。
   *
   * @param {string} text 文本。
   * @returns {boolean} 是否成功发送。
   */
  sendKey(text) {
    if (this.terminalId === null) {
      return false;
    }
    return this.connection.send(this.encoder.encode(text));
  }

  /**
   * 发送粘贴内容；括号粘贴模式开启时自动包裹。
   *
   * @param {string} text 文本。
   * @returns {boolean} 是否成功发送。
   */
  sendPaste(text) {
    if (this.terminalId === null) {
      return false;
    }
    const payload = this.screen.bracketPaste
      ? `\x1b[200~${text}\x1b[201~`
      : text;
    return this.connection.send(this.encoder.encode(payload));
  }

  /** 让终端获得键盘焦点。 */
  focusTerminal() {
    this.renderer.focus();
  }

  /** 强制重绘整个屏幕，用于清理输入法等外部修改的 DOM。 */
  refreshView() {
    this.screen.markAllDirty();
    this.renderer.sync(this.screen);
  }
}
