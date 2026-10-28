/**
 * 顶部操作栏。
 *
 * 负责渲染连接状态点、过期时间、Terminal ID 输入框以及新建/连接、
 * 断开、关闭三个按钮的全部状态，并把用户操作转交给控制器。
 */

import { formatExpiry } from "./format.js";

/**
 * 顶部操作栏组件。
 */
export class Topbar {
  /**
   * @param {{onCreate: Function, onConnect: Function, onDisconnect: Function, onClose: Function}} callbacks 操作回调。
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.statusDot = document.getElementById("connection-dot");
    this.expiryLabel = document.getElementById("expiry-label");
    this.input = document.getElementById("terminal-id-input");
    this.primaryButton = document.getElementById("primary-button");
    this.disconnectButton = document.getElementById("disconnect-button");
    this.closeButton = document.getElementById("close-button");

    this.state = {
      connectedId: null,
      expiry: null,
      busy: null,
    };

    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (event) =>
      this.handleInputKeyDown(event)
    );
    this.primaryButton.addEventListener("click", () =>
      this.handlePrimaryAction()
    );
    this.disconnectButton.addEventListener("click", () =>
      this.callbacks.onDisconnect()
    );
    this.closeButton.addEventListener("click", () => this.callbacks.onClose());

    this.render();
  }

  /**
   * 更新组件状态并重新渲染。
   *
   * @param {{connectedId?: string|null, expiry?: number|null, busy?: string|null}} state 新状态。
   */
  update(state) {
    this.state = { ...this.state, ...state };
    this.render();
  }

  /**
   * 读取 Terminal ID 输入框内容。
   *
   * @returns {string} 输入内容。
   */
  getInputValue() {
    return this.input.value;
  }

  /**
   * 设置 Terminal ID 输入框内容。
   *
   * @param {string} value 新内容。
   */
  setInputValue(value) {
    this.input.value = value;
    this.render();
  }

  /** 让 Terminal ID 输入框获得焦点。 */
  focusInput() {
    this.input.focus();
  }

  /**
   * 处理输入框内的按键。
   *
   * @param {KeyboardEvent} event 键盘事件。
   */
  handleInputKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      this.handlePrimaryAction();
    }
  }

  /** 处理主按钮点击。 */
  handlePrimaryAction() {
    if (this.state.busy !== null) {
      return;
    }
    const terminalId = this.input.value.trim();
    if (terminalId === "") {
      this.callbacks.onCreate();
      return;
    }
    if (this.state.connectedId && terminalId === this.state.connectedId) {
      return;
    }
    this.callbacks.onConnect(terminalId);
  }

  /** 根据当前状态渲染整个操作栏。 */
  render() {
    const busy = this.state.busy;
    const connectedId = this.state.connectedId;
    const connected = Boolean(connectedId);
    const inputValue = this.input.value.trim();
    const sameTerminal = connected && inputValue === connectedId;

    this.statusDot.classList.toggle("status-dot--connected", connected);
    this.statusDot.title = connected ? "已连接 Terminal" : "未连接 Terminal";
    this.expiryLabel.textContent = connected
      ? formatExpiry(this.state.expiry)
      : "\u2014";

    this.disconnectButton.classList.toggle("is-hidden", !connected);
    this.closeButton.classList.toggle("is-hidden", !connected);
    this.disconnectButton.disabled = !connected || busy !== null;
    this.closeButton.disabled = !connected || busy !== null;

    const deleting = busy === "deleting";
    this.closeButton.textContent = deleting ? "删除中" : "关闭";
    this.closeButton.classList.toggle("is-loading", deleting);

    this.input.disabled = busy !== null;

    let label = inputValue === "" ? "新建" : "连接";
    let disabled = false;
    if (busy === "creating") {
      label = "创建中";
      disabled = true;
    } else if (busy === "connecting") {
      label = "连接中";
      disabled = true;
    } else if (busy === "deleting") {
      disabled = true;
    } else if (sameTerminal) {
      disabled = true;
    }

    this.primaryButton.textContent = label;
    this.primaryButton.disabled = disabled;
    this.primaryButton.classList.toggle(
      "is-loading",
      busy === "creating" || busy === "connecting"
    );
  }
}
