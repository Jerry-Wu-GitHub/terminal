/**
 * 终端 DOM 渲染器。
 *
 * 采用增量渲染：滚动历史按追加/裁剪方式维护，屏幕区只重绘脏行。
 * 文本直接写入 DOM，因此可以像普通网页文字一样被鼠标拖动选中。
 * 虚拟光标是独立的绝对定位元素。
 */

import { BLANK_CELL } from "./screen.js";
import { DEFAULT_STYLE, resolveStyle } from "./style.js";

/**
 * 把样式应用到 span 元素。
 *
 * @param {HTMLElement} element 目标元素。
 * @param {Object} style 样式对象。
 */
function applyCellStyle(element, style) {
  const resolved = resolveStyle(style);
  if (!resolved) {
    return;
  }
  if (resolved.color) {
    element.style.color = resolved.color;
  }
  if (resolved.backgroundColor) {
    element.style.backgroundColor = resolved.backgroundColor;
  }
  if (resolved.fontWeight) {
    element.style.fontWeight = resolved.fontWeight;
  }
  if (resolved.fontStyle) {
    element.style.fontStyle = resolved.fontStyle;
  }
  if (resolved.opacity) {
    element.style.opacity = resolved.opacity;
  }
  if (resolved.textDecoration) {
    element.style.textDecoration = resolved.textDecoration;
  }
  if (resolved.blink) {
    element.classList.add("terminal-blink");
  }
}

/**
 * 终端渲染器。
 */
export class TerminalRenderer {
  /**
   * @param {Object} elements 页面元素集合。
   */
  constructor(elements) {
    this.scrollContainer = elements.scrollContainer;
    this.paper = elements.paper;
    this.scrollbackContainer = elements.scrollbackContainer;
    this.screenContainer = elements.screenContainer;
    this.cursorElement = elements.cursorElement;

    this.followOutput = true;
    this.clearRevision = -1;
    this.renderedScrollbackGeneration = -1;
    this.renderedScrollbackAdded = 0;
    this.renderedScrollbackTrimmed = 0;
    this.screenRowElements = [];
  }

  /** 绑定滚动事件。 */
  initialize() {
    this.scrollContainer.addEventListener("scroll", () => {
      this.updateFollowState();
    });
    this.updateFollowState();
  }

  /** 根据滚动位置更新“跟随输出”状态。 */
  updateFollowState() {
    const container = this.scrollContainer;
    const remaining =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    this.followOutput = remaining <= 4;
  }

  /** 新会话开始时重置视图状态。 */
  resetView() {
    this.followOutput = true;
    this.renderedScrollbackGeneration = -1;
  }

  /**
   * 强制重建整个终端 DOM。
   *
   * 用于清理输入法等外部操作对 contenteditable 造成的临时修改，
   * 包括可能被写进滚动历史区域的文本。
   *
   * @param {Object} screen 屏幕对象。
   */
  rebuild(screen) {
    this.renderedScrollbackGeneration = -1;
    this.screenRowElements = [];
    this.sync(screen);
  }

  /**
   * 把屏幕内容同步到 DOM。
   *
   * @param {Object} screen 屏幕对象。
   */
  sync(screen) {
    this.paper.style.setProperty(
      "--terminal-columns",
      String(screen.columns)
    );
    this.paper.style.setProperty("--terminal-rows", String(screen.rows));
    this.syncScrollback(screen);
    this.syncScreenRows(screen);
    this.syncCursor(screen);

    if (screen.clearRevision !== this.clearRevision) {
      this.clearRevision = screen.clearRevision;
      this.followOutput = true;
    }

    if (this.followOutput) {
      this.scrollToBottom();
    }
  }

  /**
   * 同步回看历史区域。
   *
   * @param {Object} screen 屏幕对象。
   */
  syncScrollback(screen) {
    this.scrollbackContainer.classList.toggle(
      "is-hidden",
      screen.alternateActive
    );

    if (screen.scrollbackGeneration !== this.renderedScrollbackGeneration) {
      this.scrollbackContainer.replaceChildren();
      this.renderedScrollbackGeneration = screen.scrollbackGeneration;
      this.renderedScrollbackAdded = 0;
      this.renderedScrollbackTrimmed = 0;
    }

    const trimCount =
      screen.scrollbackTrimmed - this.renderedScrollbackTrimmed;
    for (let index = 0; index < trimCount; index += 1) {
      this.scrollbackContainer.firstElementChild?.remove();
    }
    this.renderedScrollbackTrimmed = screen.scrollbackTrimmed;

    const startIndex = Math.max(
      0,
      this.renderedScrollbackAdded - screen.scrollbackTrimmed
    );
    const endIndex = screen.scrollbackAdded - screen.scrollbackTrimmed;
    const fragment = document.createDocumentFragment();
    for (let index = startIndex; index < endIndex; index += 1) {
      const cells = screen.scrollback[index];
      if (cells) {
        fragment.appendChild(this.createRowElement(cells));
      }
    }
    if (fragment.childNodes.length > 0) {
      this.scrollbackContainer.appendChild(fragment);
    }
    this.renderedScrollbackAdded = screen.scrollbackAdded;
  }

  /**
   * 同步屏幕区域。
   *
   * @param {Object} screen 屏幕对象。
   */
  syncScreenRows(screen) {
    if (this.screenRowElements.length !== screen.rows) {
      this.buildScreenRowElements(screen);
      screen.takeDirtyRows();
      return;
    }

    const dirtyRows = screen.takeDirtyRows();
    for (const rowIndex of dirtyRows) {
      const element = this.screenRowElements[rowIndex];
      const cells = screen.screenRows[rowIndex];
      if (element && cells) {
        this.renderRowElement(element, cells);
      }
    }
  }

  /**
   * 重建屏幕区的所有行元素。
   *
   * @param {Object} screen 屏幕对象。
   */
  buildScreenRowElements(screen) {
    const fragment = document.createDocumentFragment();
    this.screenRowElements = [];
    for (let index = 0; index < screen.rows; index += 1) {
      const element = document.createElement("div");
      element.className = "terminal-row";
      element.spellcheck = false;
      fragment.appendChild(element);
      this.screenRowElements.push(element);
    }
    this.screenContainer.replaceChildren(fragment);
    for (let index = 0; index < screen.rows; index += 1) {
      const cells = screen.screenRows[index];
      if (cells) {
        this.renderRowElement(this.screenRowElements[index], cells);
      }
    }
  }

  /**
   * 创建一行对应的 DOM 元素。
   *
   * @param {Array} cells 行单元格。
   * @returns {HTMLElement} 行元素。
   */
  createRowElement(cells) {
    const element = document.createElement("div");
    element.className = "terminal-row";
    element.spellcheck = false;
    this.renderRowElement(element, cells);
    return element;
  }

  /**
   * 渲染一行的单元格内容。
   *
   * @param {HTMLElement} element 行元素。
   * @param {Array} cells 行单元格。
   */
  renderRowElement(element, cells) {
    const fragment = document.createDocumentFragment();
    let endIndex = cells.length;
    while (endIndex > 0 && cells[endIndex - 1] === BLANK_CELL) {
      endIndex -= 1;
    }

    let index = 0;
    while (index < endIndex) {
      const cell = cells[index];
      if (cell.width === 0) {
        index += 1;
        continue;
      }
      const style = cell.style;
      const group = document.createElement("span");
      applyCellStyle(group, style);
      const textParts = [];

      while (index < endIndex) {
        const current = cells[index];
        if (current.style !== style) {
          break;
        }
        if (current.width === 0) {
          index += 1;
          continue;
        }
        if (current.width === 2) {
          if (textParts.length > 0) {
            group.appendChild(document.createTextNode(textParts.join("")));
            textParts.length = 0;
          }
          const wide = document.createElement("span");
          wide.className = "terminal-wide-character";
          wide.textContent = current.text;
          group.appendChild(wide);
          index += 1;
          if (index < endIndex && cells[index].width === 0) {
            index += 1;
          }
        } else {
          textParts.push(current.text);
          index += 1;
        }
      }

      if (textParts.length > 0) {
        group.appendChild(document.createTextNode(textParts.join("")));
      }
      fragment.appendChild(group);
    }

    element.replaceChildren(fragment);
  }

  /**
   * 更新虚拟光标位置与显隐。
   *
   * @param {Object} screen 屏幕对象。
   */
  syncCursor(screen) {
    const scrollbackRows = screen.alternateActive ? 0 : screen.scrollback.length;
    const absoluteRow = scrollbackRows + screen.cursor.row;
    this.cursorElement.style.setProperty("--cursor-row", String(absoluteRow));
    this.cursorElement.style.setProperty(
      "--cursor-column",
      String(screen.cursor.column)
    );
    this.cursorElement.classList.toggle(
      "terminal-cursor--hidden",
      !screen.cursorVisible
    );
  }

  /** 滚动到底部。 */
  scrollToBottom() {
    this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
  }

  /** 让终端获得键盘焦点。 */
  focus() {
    this.paper.focus({ preventScroll: true });
  }

  /**
   * 获取终端内当前选中的文本。
   *
   * @returns {string} 选中文本；未选中时为空串。
   */
  getSelectionText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return "";
    }
    const range = selection.getRangeAt(0);
    if (!this.paper.contains(range.commonAncestorContainer)) {
      return "";
    }
    return selection.toString();
  }
}
