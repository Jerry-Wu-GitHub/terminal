/**
 * 虚拟终端屏幕缓冲区。
 *
 * 负责维护一个 rows × columns 的字符网格、滚动回看历史（scrollback）、
 * 光标位置以及当前 SGR 样式。单元格是不可变对象：
 * { text, width, style }，宽度为 0 的单元格表示宽字符占用的第二列。
 *
 * 擦除、插入/删除、备用屏幕等编辑操作位于 `screen-editing.js`，
 * 解析器直接调用那些函数。
 */

import {
  DEFAULT_TERMINAL_COLUMNS,
  DEFAULT_TERMINAL_ROWS,
  MAX_SCROLLBACK_LINES,
} from "../config.js";
import { getClusterWidth } from "./width.js";
import { DEFAULT_STYLE } from "./style.js";

/** 空白单元格（不可变，可安全共享）。 */
export const BLANK_CELL = Object.freeze({
  text: " ",
  width: 1,
  style: DEFAULT_STYLE,
});

/** 宽字符占用的第二列。 */
function createContinuationCell(style) {
  return { text: "", width: 0, style };
}

/**
 * 虚拟终端屏幕。
 */
export class TerminalScreen {
  /**
   * @param {number} [columns] 列数。
   * @param {number} [rows] 行数。
   */
  constructor(
    columns = DEFAULT_TERMINAL_COLUMNS,
    rows = DEFAULT_TERMINAL_ROWS
  ) {
    this.columns = DEFAULT_TERMINAL_COLUMNS;
    this.rows = DEFAULT_TERMINAL_ROWS;
    this.scrollbackGeneration = 0;
    this.clearRevision = 0;
    this.dirtyRows = new Set();
    this.segmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter("zh", { granularity: "grapheme" })
        : null;
    this.reset(columns, rows);
  }

  /**
   * 重置整个屏幕与回看历史。
   *
   * @param {number} [columns] 新列数；省略时保持当前值。
   * @param {number} [rows] 新行数；省略时保持当前值。
   */
  reset(columns, rows) {
    this.columns = Math.max(
      1,
      Math.trunc(columns || this.columns) || DEFAULT_TERMINAL_COLUMNS
    );
    this.rows = Math.max(
      1,
      Math.trunc(rows || this.rows) || DEFAULT_TERMINAL_ROWS
    );
    this.scrollback = [];
    this.scrollbackGeneration += 1;
    this.scrollbackAdded = 0;
    this.scrollbackTrimmed = 0;
    this.screenRows = this.createBlankRows();
    this.cursor = { row: 0, column: 0 };
    this.savedCursor = null;
    this.savedMainScreen = null;
    this.alternateActive = false;
    this.currentStyle = DEFAULT_STYLE;
    this.autoWrap = true;
    this.cursorVisible = true;
    this.bracketPaste = false;
    this.applicationCursorKeys = false;
    this.wrapPending = false;
    this.clearRevision += 1;
    this.markAllDirty();
  }

  /**
   * 创建全为空白的一行。
   *
   * @returns {Array} 行数组。
   */
  createBlankRow() {
    return new Array(this.columns).fill(BLANK_CELL);
  }

  /**
   * 创建全为空白的一组行。
   *
   * @returns {Array<Array>} 行数组的数组。
   */
  createBlankRows() {
    const rows = new Array(this.rows);
    for (let index = 0; index < this.rows; index += 1) {
      rows[index] = this.createBlankRow();
    }
    return rows;
  }

  /**
   * 标记一行需要重新渲染。
   *
   * @param {number} rowIndex 行下标。
   */
  markRow(rowIndex) {
    if (rowIndex >= 0 && rowIndex < this.rows) {
      this.dirtyRows.add(rowIndex);
    }
  }

  /**
   * 标记从某行开始的所有行需要重新渲染。
   *
   * @param {number} startRow 起始行下标。
   */
  markRowsFrom(startRow) {
    for (let index = Math.max(0, startRow); index < this.rows; index += 1) {
      this.dirtyRows.add(index);
    }
  }

  /** 标记全部行需要重新渲染。 */
  markAllDirty() {
    this.markRowsFrom(0);
  }

  /**
   * 取出并清空脏行集合。
   *
   * @returns {number[]} 脏行下标。
   */
  takeDirtyRows() {
    const rows = [...this.dirtyRows];
    this.dirtyRows.clear();
    return rows;
  }

  /**
   * 设置当前 SGR 样式。
   *
   * @param {Object} style 不可变样式对象。
   */
  setStyle(style) {
    this.currentStyle = style;
  }

  /**
   * 输出一段可打印文本。
   *
   * @param {string} text 文本。
   */
  printText(text) {
    if (!text) {
      return;
    }
    if (!this.segmenter) {
      for (const character of text) {
        this.printCluster(character);
      }
      return;
    }
    for (const segment of this.segmenter.segment(text)) {
      this.printCluster(segment.segment);
    }
  }

  /**
   * 输出一个字素簇。
   *
   * @param {string} cluster 字素簇。
   */
  printCluster(cluster) {
    const width = getClusterWidth(cluster);
    if (width === 0) {
      this.appendToPreviousCell(cluster);
      return;
    }

    if (this.wrapPending) {
      if (this.autoWrap) {
        this.carriageReturn();
        this.lineFeed();
      }
      this.wrapPending = false;
    }

    let cellWidth = width;
    if (cellWidth === 2 && this.cursor.column >= this.columns - 1) {
      if (this.autoWrap) {
        this.carriageReturn();
        this.lineFeed();
      } else {
        cellWidth = 1;
      }
    }

    const row = this.cursor.row;
    const column = this.cursor.column;
    this.prepareForWrite(row, column);
    if (cellWidth === 2) {
      this.prepareForWrite(row, column + 1);
    }

    const style = this.currentStyle;
    this.screenRows[row][column] = { text: cluster, width: cellWidth, style };
    if (cellWidth === 2) {
      this.screenRows[row][column + 1] = createContinuationCell(style);
    }
    this.markRow(row);

    const nextColumn = column + cellWidth;
    if (nextColumn >= this.columns) {
      this.cursor.column = this.columns - 1;
      this.wrapPending = this.autoWrap;
    } else {
      this.cursor.column = nextColumn;
    }
  }

  /**
   * 把零宽字符附加到前一个单元格。
   *
   * @param {string} text 零宽字符。
   */
  appendToPreviousCell(text) {
    let column = this.wrapPending ? this.columns - 1 : this.cursor.column - 1;
    if (column < 0) {
      return;
    }
    let cell = this.screenRows[this.cursor.row][column];
    if (cell.width === 0 && column > 0) {
      column -= 1;
      cell = this.screenRows[this.cursor.row][column];
    }
    if (!cell || cell.width === 0) {
      return;
    }
    this.screenRows[this.cursor.row][column] = {
      ...cell,
      text: cell.text + text,
    };
    this.markRow(this.cursor.row);
  }

  /**
   * 在写入前清理目标位置上的宽字符碎片。
   *
   * @param {number} rowIndex 行下标。
   * @param {number} columnIndex 列下标。
   */
  prepareForWrite(rowIndex, columnIndex) {
    const row = this.screenRows[rowIndex];
    if (!row || columnIndex < 0 || columnIndex >= this.columns) {
      return;
    }
    const cell = row[columnIndex];
    if (cell.width === 0) {
      if (columnIndex > 0) {
        row[columnIndex - 1] = BLANK_CELL;
      }
      row[columnIndex] = BLANK_CELL;
      return;
    }
    if (cell.width === 2) {
      row[columnIndex] = BLANK_CELL;
      if (columnIndex + 1 < this.columns) {
        row[columnIndex + 1] = BLANK_CELL;
      }
    }
  }

  /** 光标回到行首。 */
  carriageReturn() {
    this.cursor.column = 0;
    this.wrapPending = false;
  }

  /** 光标下移一行；已在底部时向上滚动。 */
  lineFeed() {
    this.wrapPending = false;
    if (this.cursor.row < this.rows - 1) {
      this.cursor.row += 1;
    } else {
      this.scrollUp(1);
    }
  }

  /** 光标左移一格（不擦除）。 */
  backspace() {
    this.wrapPending = false;
    if (this.cursor.column > 0) {
      this.cursor.column -= 1;
    }
  }

  /** 光标移动到下一个制表位。 */
  tab() {
    this.wrapPending = false;
    const nextStop = (Math.floor(this.cursor.column / 8) + 1) * 8;
    this.cursor.column = Math.min(this.columns - 1, nextStop);
  }

  /**
   * 光标后退若干个制表位。
   *
   * @param {number} count 制表位数量。
   */
  tabBackward(count = 1) {
    this.wrapPending = false;
    let column = this.cursor.column;
    for (let index = 0; index < count; index += 1) {
      column = Math.max(0, (Math.ceil(column / 8) - 1) * 8);
    }
    this.cursor.column = column;
  }

  /**
   * 把光标移到指定位置（越界自动夹取）。
   *
   * @param {number} rowIndex 行下标。
   * @param {number} columnIndex 列下标。
   */
  moveCursorTo(rowIndex, columnIndex) {
    this.cursor.row = Math.max(
      0,
      Math.min(this.rows - 1, Math.trunc(rowIndex))
    );
    this.cursor.column = Math.max(
      0,
      Math.min(this.columns - 1, Math.trunc(columnIndex))
    );
    this.wrapPending = false;
  }

  /**
   * 相对移动光标。
   *
   * @param {number} rowDelta 行偏移。
   * @param {number} columnDelta 列偏移。
   */
  moveCursorBy(rowDelta, columnDelta) {
    this.moveCursorTo(
      this.cursor.row + rowDelta,
      this.cursor.column + columnDelta
    );
  }

  /** 保存光标位置与样式。 */
  saveCursor() {
    this.savedCursor = {
      row: this.cursor.row,
      column: this.cursor.column,
      style: this.currentStyle,
      wrapPending: this.wrapPending,
    };
  }

  /** 恢复光标位置与样式。 */
  restoreCursor() {
    if (!this.savedCursor) {
      return;
    }
    this.cursor.row = this.savedCursor.row;
    this.cursor.column = this.savedCursor.column;
    this.currentStyle = this.savedCursor.style;
    this.wrapPending = this.savedCursor.wrapPending;
  }

  /**
   * 向上滚动指定行数；滚出屏幕顶部的行进入回看历史。
   *
   * @param {number} count 行数。
   */
  scrollUp(count = 1) {
    const amount = Math.max(1, Math.trunc(count) || 1);
    for (let index = 0; index < amount; index += 1) {
      const removed = this.screenRows.shift();
      if (!this.alternateActive) {
        this.scrollback.push(removed);
        this.scrollbackAdded += 1;
        while (this.scrollback.length > MAX_SCROLLBACK_LINES) {
          this.scrollback.shift();
          this.scrollbackTrimmed += 1;
        }
      }
      this.screenRows.push(this.createBlankRow());
    }
    this.markAllDirty();
  }
}
