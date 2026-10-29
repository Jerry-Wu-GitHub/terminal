/**
 * 终端输入桥。
 *
 * 把键盘、输入法、粘贴、右键菜单事件翻译为终端输入或剪贴板操作。
 * 终端内容使用 contenteditable 承载，从而获得浏览器原生的文字选中
 * 能力与 paste 事件。普通文本插入在 beforeinput 阶段被拦截并直接
 * 发送；输入法组合过程则放行给浏览器，待 compositionend 时再发送
 * 最终文本并重绘屏幕。
 */

import {
  getSelectionWithin,
  readClipboard,
  writeClipboard,
} from "../terminal/clipboard.js";
import { resolveKeyAction } from "../terminal/input.js";

/**
 * 输入事件桥。
 */
export class InputBridge {
  /**
   * @param {Object} options 依赖项。
   * @param {HTMLElement} options.paper 终端内容元素。
   * @param {Object} options.screen 屏幕对象。
   * @param {Object} options.controller 会话控制器。
   * @param {Function} options.showInfo 信息提示。
   * @param {Function} options.showError 错误提示。
   * @param {Function} options.showSuccess 成功提示。
   */
  constructor({ paper, screen, controller, showInfo, showError, showSuccess }) {
    this.paper = paper;
    this.screen = screen;
    this.controller = controller;
    this.showInfo = showInfo;
    this.showError = showError;
    this.showSuccess = showSuccess;
    this.pendingSelection = "";
    this.pendingSelectionTime = 0;
    this.composing = false;
    this.lastCompositionText = "";
    this.lastCompositionEndTime = 0;
  }

  /** 注册所有事件监听。 */
  initialize() {
    this.paper.addEventListener("keydown", (event) =>
      this.handleKeyDown(event)
    );
    this.paper.addEventListener("paste", (event) => this.handlePaste(event));
    this.paper.addEventListener("beforeinput", (event) =>
      this.handleBeforeInput(event)
    );
    this.paper.addEventListener("compositionstart", () =>
      this.handleCompositionStart()
    );
    this.paper.addEventListener("compositionend", (event) =>
      this.handleCompositionEnd(event)
    );
    this.paper.addEventListener("blur", () => this.handleBlur());
    this.paper.addEventListener("mousedown", (event) =>
      this.handleMouseDown(event)
    );
    this.paper.addEventListener("contextmenu", (event) =>
      this.handleContextMenu(event)
    );
    this.paper.addEventListener("drop", (event) => event.preventDefault());
  }

  /**
   * 处理 beforeinput 事件。
   *
   * 输入法组合相关的插入必须放行，否则浏览器无法启动或维持组合；
   * 其余编辑行为一律取消，并转换成本端终端的按键字节发送。
   *
   * @param {InputEvent} event 输入事件。
   */
  handleBeforeInput(event) {
    const inputType = event.inputType || "";
    const isCompositionRelated = inputType.includes("Composition");

    if (this.composing || event.isComposing) {
      return;
    }

    if (!this.controller.isConnected) {
      event.preventDefault();
      return;
    }

    if (
      isCompositionRelated ||
      inputType === "insertText" ||
      inputType === "insertReplacementText"
    ) {
      event.preventDefault();
      const text = event.data || "";
      if (text === "") {
        return;
      }
      const compositionAge = Date.now() - this.lastCompositionEndTime;
      if (text === this.lastCompositionText && compositionAge < 300) {
        this.lastCompositionText = "";
        return;
      }
      this.controller.sendKey(text);
      return;
    }

    if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
      event.preventDefault();
      this.controller.sendKey("\r");
      return;
    }

    if (inputType === "deleteContentBackward") {
      event.preventDefault();
      this.controller.sendKey("\x7f");
      return;
    }

    if (inputType === "deleteContentForward") {
      event.preventDefault();
      this.controller.sendKey("\x1b[3~");
      return;
    }

    event.preventDefault();
  }

  /** 输入法开始组合。 */
  handleCompositionStart() {
    this.composing = true;
    this.lastCompositionText = "";
    this.lastCompositionEndTime = 0;
  }

  /**
   * 处理输入法组合结束，把最终文本发送到终端。
   *
   * 组合过程中浏览器会临时修改 contenteditable 的 DOM，因此结束后
   * 强制重绘一次屏幕。
   *
   * @param {CompositionEvent} event 组合事件。
   */
  handleCompositionEnd(event) {
    this.composing = false;
    const text = event.data || "";
    if (text !== "") {
      this.lastCompositionText = text;
      this.lastCompositionEndTime = Date.now();
      if (this.controller.isConnected) {
        this.controller.sendKey(text);
      } else {
        this.showError("未连接 Terminal");
      }
    }
    this.controller.refreshView();
  }

  /**
   * 终端失焦时清理可能残留的组合状态。
   *
   * 少数情况下浏览器不会为被中断的组合派发 compositionend，若此时
   * 组合标记一直为真，后续普通输入会被误放行。失焦时兜底重置。
   */
  handleBlur() {
    if (!this.composing) {
      return;
    }
    this.composing = false;
    this.lastCompositionText = "";
    this.lastCompositionEndTime = 0;
    this.controller.refreshView();
  }

  /**
   * 在按下鼠标时记录当前选区。
   *
   * 浏览器在右键点击选区外时会先折叠选区，导致 contextmenu 事件里
   * 读不到用户原本选中的文字；这里提前记一份快照。
   *
   * @param {MouseEvent} event 鼠标事件。
   */
  handleMouseDown(event) {
    if (event.button === 2) {
      this.pendingSelection = getSelectionWithin(this.paper);
      this.pendingSelectionTime = Date.now();
    } else {
      this.pendingSelection = "";
      this.pendingSelectionTime = 0;
    }
  }

  /**
   * 处理键盘输入。
   *
   * @param {KeyboardEvent} event 键盘事件。
   */
  handleKeyDown(event) {
    const selectedText = getSelectionWithin(this.paper);
    const action = resolveKeyAction(event, this.screen, selectedText !== "");
    if (!action) {
      return;
    }

    if (action.type === "copy") {
      event.preventDefault();
      if (selectedText !== "") {
        this.copyText(selectedText);
      }
      return;
    }

    if (action.type === "paste") {
      // 不阻止默认行为，让浏览器派发 paste 事件，避免重复发送。
      return;
    }

    event.preventDefault();
    if (!this.controller.isConnected) {
      return;
    }
    this.controller.sendKey(action.text);
  }

  /**
   * 处理浏览器 paste 事件。
   *
   * @param {ClipboardEvent} event 粘贴事件。
   */
  handlePaste(event) {
    event.preventDefault();
    const text = event.clipboardData
      ? event.clipboardData.getData("text/plain")
      : "";
    if (text === "") {
      return;
    }
    if (!this.controller.isConnected) {
      this.showError("未连接 Terminal");
      return;
    }
    this.controller.sendPaste(text);
  }

  /**
   * 处理终端内右键菜单。
   *
   * 有选区时复制，无选区时粘贴。
   *
   * @param {MouseEvent} event 右键事件。
   */
  handleContextMenu(event) {
    event.preventDefault();
    let selectedText = getSelectionWithin(this.paper);
    const snapshotAge = Date.now() - this.pendingSelectionTime;
    if (selectedText === "" && snapshotAge < 1500) {
      selectedText = this.pendingSelection;
    }
    this.pendingSelection = "";
    this.pendingSelectionTime = 0;
    if (selectedText !== "") {
      this.copyText(selectedText);
      return;
    }
    this.pasteFromClipboard();
  }

  /**
   * 复制文本并提示结果。
   *
   * @param {string} text 文本。
   */
  async copyText(text) {
    const success = await writeClipboard(text);
    this.paper.focus({ preventScroll: true });
    if (success) {
      this.showSuccess("已复制");
    } else {
      this.showError("复制到剪贴板失败");
    }
  }

  /** 从系统剪贴板读取文本并粘贴到终端。 */
  async pasteFromClipboard() {
    if (!this.controller.isConnected) {
      this.showError("未连接 Terminal");
      this.paper.focus({ preventScroll: true });
      return;
    }

    const text = await readClipboard();
    this.paper.focus({ preventScroll: true });
    if (text === null) {
      this.showInfo("无法读取剪贴板，请使用 Ctrl+V 粘贴");
      return;
    }
    if (text === "") {
      this.showInfo("剪贴板为空");
      return;
    }
    this.controller.sendPaste(text);
  }
}
