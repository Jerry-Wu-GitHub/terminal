/**
 * 终端输入桥。
 *
 * 把键盘、输入法、粘贴、鼠标与右键菜单事件翻译为终端输入或剪贴板
 * 操作。终端内容使用 contenteditable 承载，从而获得浏览器原生的文字
 * 选中能力与 paste 事件。普通文本插入在 beforeinput 阶段被拦截并直接
 * 发送；输入法组合过程则放行给浏览器，待 compositionend 时再发送
 * 最终文本并重绘屏幕。
 */

import {
  getSelectionWithin,
  readClipboard,
  writeClipboard,
} from "../terminal/clipboard.js";
import { resolveKeyAction } from "../terminal/input.js";
import { encodeMouseEvent, wheelButtonCode } from "../terminal/mouse.js";

/**
 * 输入事件桥。
 */
export class InputBridge {
  /**
   * @param {Object} options 依赖项。
   * @param {HTMLElement} options.paper 终端内容元素。
   * @param {Object} options.screen 屏幕对象。
   * @param {Object} options.renderer 终端渲染器。
   * @param {Object} options.controller 会话控制器。
   * @param {Function} options.showInfo 信息提示。
   * @param {Function} options.showError 错误提示。
   * @param {Function} options.showSuccess 成功提示。
   */
  constructor({
    paper,
    screen,
    renderer,
    controller,
    showInfo,
    showError,
    showSuccess,
  }) {
    this.paper = paper;
    this.screen = screen;
    this.renderer = renderer;
    this.controller = controller;
    this.showInfo = showInfo;
    this.showError = showError;
    this.showSuccess = showSuccess;
    this.pendingSelection = "";
    this.pendingSelectionTime = 0;
    this.composing = false;
    this.lastCompositionText = "";
    this.lastCompositionEndTime = 0;
    this.mouseButtons = 0;
    this.lastMouseCell = null;
    this.lastMotionCell = null;
    this.pendingMouseMove = null;
    this.mouseMoveFrame = 0;
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
    this.paper.addEventListener("wheel", (event) => this.handleWheel(event), {
      passive: false,
    });
    this.paper.addEventListener("auxclick", (event) =>
      this.handleAuxClick(event)
    );
    this.paper.addEventListener("contextmenu", (event) =>
      this.handleContextMenu(event)
    );
    this.paper.addEventListener("drop", (event) => event.preventDefault());
    window.addEventListener("mousemove", (event) =>
      this.handleMouseMove(event)
    );
    window.addEventListener("mouseup", (event) => this.handleMouseUp(event));
    window.addEventListener("blur", () => this.releaseMouseButtons());
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
   * 处理终端内的鼠标按下。
   *
   * 鼠标追踪开启时把按键事件转发给远端程序，并阻止浏览器的文本选中；
   * 按住 Shift 时按惯例放行本地选中。未转发时继续维护右键选区快照。
   *
   * @param {MouseEvent} event 鼠标事件。
   */
  handleMouseDown(event) {
    if (this.reportMouseDown(event)) {
      return;
    }
    if (event.button === 2) {
      this.pendingSelection = getSelectionWithin(this.paper);
      this.pendingSelectionTime = Date.now();
    } else {
      this.pendingSelection = "";
      this.pendingSelectionTime = 0;
    }
  }

  /**
   * 尝试把鼠标按下事件转发给远端程序。
   *
   * @param {MouseEvent} event 鼠标事件。
   * @returns {boolean} 是否已拦截该事件。
   */
  reportMouseDown(event) {
    if (this.screen.mouseTrackingMode === 0) {
      this.resetMouseState();
      return false;
    }
    if (event.shiftKey) {
      return false;
    }
    if (!this.controller.isConnected) {
      this.resetMouseState();
      return false;
    }
    if (event.button < 0 || event.button > 2) {
      return false;
    }
    const cell = this.renderer.resolveCellAt(
      event.clientX,
      event.clientY,
      this.screen
    );
    if (!cell) {
      return false;
    }

    event.preventDefault();
    this.cancelPendingMouseMove();
    this.paper.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
    this.pendingSelection = "";
    this.pendingSelectionTime = 0;
    this.mouseButtons |= 1 << event.button;
    this.lastMouseCell = cell;
    this.sendMouseEvent({
      kind: "press",
      button: event.button,
      buttons: this.mouseButtons,
      column: cell.column,
      row: cell.row,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    return true;
  }

  /**
   * 处理鼠标移动，向远端程序上报悬停或拖拽。
   *
   * 事件监听挂在 window 上，以便拖拽出终端区域后仍能继续上报坐标。
   *
   * @param {MouseEvent} event 鼠标事件。
   */
  handleMouseMove(event) {
    const mode = this.screen.mouseTrackingMode;
    if (mode === 0) {
      this.cancelPendingMouseMove();
      this.lastMotionCell = null;
      return;
    }
    if (!this.controller.isConnected) {
      this.resetMouseState();
      return;
    }
    if (mode !== 1002 && mode !== 1003) {
      return;
    }
    if (this.mouseButtons === 0 && !this.paper.contains(event.target)) {
      return;
    }
    if (event.shiftKey) {
      return;
    }

    const dragging = this.mouseButtons !== 0;
    if (!dragging && event.buttons !== 0) {
      return;
    }
    if (!dragging && mode !== 1003) {
      return;
    }
    const buttons = dragging ? this.mouseButtons : 0;
    const cell = this.renderer.resolveCellAt(
      event.clientX,
      event.clientY,
      this.screen,
      dragging
    );
    if (!cell) {
      return;
    }

    this.pendingMouseMove = {
      cell,
      buttons,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
    this.scheduleMouseMove();
  }

  /**
   * 安排一次合并后的移动上报。
   *
   * 指针移动可能远快于远端程序的处理速度，这里用动画帧把同一帧内的
   * 多次移动合并为最后一次坐标，避免刷屏。
   */
  scheduleMouseMove() {
    if (this.mouseMoveFrame !== 0) {
      return;
    }
    this.mouseMoveFrame = window.requestAnimationFrame(() => {
      this.mouseMoveFrame = 0;
      this.flushMouseMove();
    });
  }

  /**
   * 发送待处理的移动事件。
   *
   * 只有单元格坐标发生变化时才真正发送，避免同一个格子内的高频
   * 指针移动反复写入后端。
   */
  flushMouseMove() {
    const pending = this.pendingMouseMove;
    this.pendingMouseMove = null;
    if (!pending || !this.controller.isConnected) {
      return;
    }
    if (
      this.lastMotionCell &&
      this.lastMotionCell.row === pending.cell.row &&
      this.lastMotionCell.column === pending.cell.column
    ) {
      return;
    }
    this.lastMotionCell = pending.cell;
    this.lastMouseCell = pending.cell;
    this.sendMouseEvent({
      kind: "motion",
      button: 0,
      buttons: pending.buttons,
      column: pending.cell.column,
      row: pending.cell.row,
      shiftKey: pending.shiftKey,
      altKey: pending.altKey,
      ctrlKey: pending.ctrlKey,
      metaKey: pending.metaKey,
    });
  }

  /** 取消尚未发送的移动事件。 */
  cancelPendingMouseMove() {
    if (this.mouseMoveFrame !== 0) {
      window.cancelAnimationFrame(this.mouseMoveFrame);
      this.mouseMoveFrame = 0;
    }
    this.pendingMouseMove = null;
  }

  /**
   * 处理鼠标松开，向远端程序上报释放。
   *
   * @param {MouseEvent} event 鼠标事件。
   */
  handleMouseUp(event) {
    if (this.mouseButtons === 0) {
      return;
    }
    if (!this.controller.isConnected) {
      this.resetMouseState();
      return;
    }
    if (event.button < 0 || event.button > 2) {
      return;
    }
    const bit = 1 << event.button;
    if ((this.mouseButtons & bit) === 0) {
      return;
    }
    const cell =
      this.renderer.resolveCellAt(event.clientX, event.clientY, this.screen) ||
      this.lastMouseCell ||
      this.renderer.resolveCellAt(
        event.clientX,
        event.clientY,
        this.screen,
        true
      );
    if (!cell) {
      return;
    }

    event.preventDefault();
    this.cancelPendingMouseMove();
    this.mouseButtons &= ~bit;
    this.lastMouseCell = cell;
    this.sendMouseEvent({
      kind: "release",
      button: event.button,
      buttons: this.mouseButtons,
      column: cell.column,
      row: cell.row,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (this.mouseButtons === 0) {
      this.lastMouseCell = null;
    }
  }

  /**
   * 处理滚轮事件，将其转换为按钮 64-67 的按下事件。
   *
   * @param {WheelEvent} event 滚轮事件。
   */
  handleWheel(event) {
    if (this.screen.mouseTrackingMode === 0 || event.shiftKey) {
      return;
    }
    if (!this.controller.isConnected) {
      this.resetMouseState();
      return;
    }
    const button = wheelButtonCode(event.deltaX, event.deltaY);
    if (button === null) {
      return;
    }
    const cell = this.renderer.resolveCellAt(
      event.clientX,
      event.clientY,
      this.screen
    );
    if (!cell) {
      return;
    }

    event.preventDefault();
    this.cancelPendingMouseMove();
    this.lastMouseCell = cell;
    this.sendMouseEvent({
      kind: "wheel",
      button,
      buttons: this.mouseButtons,
      column: cell.column,
      row: cell.row,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  }

  /**
   * 阻止鼠标追踪期间的浏览器默认辅助点击行为。
   *
   * @param {MouseEvent} event 辅助点击事件。
   */
  handleAuxClick(event) {
    if (this.screen.mouseTrackingMode === 0 || event.shiftKey) {
      return;
    }
    if (
      !this.renderer.resolveCellAt(event.clientX, event.clientY, this.screen)
    ) {
      return;
    }
    event.preventDefault();
  }

  /**
   * 向远端发送一条鼠标协议消息。
   *
   * @param {Object} event 鼠标事件描述。
   * @returns {boolean} 是否成功发送。
   */
  sendMouseEvent(event) {
    if (!this.controller.isConnected) {
      return false;
    }
    const bytes = encodeMouseEvent(this.screen, event);
    if (!bytes) {
      return false;
    }
    return this.controller.sendBytes(bytes);
  }

  /** 清空本地记录的鼠标状态。 */
  resetMouseState() {
    this.cancelPendingMouseMove();
    this.mouseButtons = 0;
    this.lastMouseCell = null;
    this.lastMotionCell = null;
  }

  /**
   * 窗口失焦时上报所有已按下的按钮，避免远端程序一直处于拖拽状态。
   */
  releaseMouseButtons() {
    if (this.mouseButtons === 0) {
      return;
    }
    this.cancelPendingMouseMove();
    const cell = this.lastMouseCell || { row: 0, column: 0 };
    for (let button = 0; button < 3; button += 1) {
      const bit = 1 << button;
      if ((this.mouseButtons & bit) === 0) {
        continue;
      }
      this.mouseButtons &= ~bit;
      this.sendMouseEvent({
        kind: "release",
        button,
        buttons: this.mouseButtons,
        column: cell.column,
        row: cell.row,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
    }
    this.lastMouseCell = null;
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
    if (this.screen.mouseTrackingMode !== 0 && !event.shiftKey) {
      const cell = this.renderer.resolveCellAt(
        event.clientX,
        event.clientY,
        this.screen
      );
      if (cell) {
        event.preventDefault();
        return;
      }
    }
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
