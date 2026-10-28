/**
 * 屏幕编辑操作。
 *
 * 这些函数修改 TerminalScreen 的网格内容，但不负责渲染。解析器在遇到
 * 擦除、插入/删除、滚动与备用屏幕相关控制序列时调用它们。
 */

import { BLANK_CELL } from "./screen.js";
import { DEFAULT_STYLE } from "./style.js";

/**
 * 修复被插入/删除操作截断的宽字符残留。
 *
 * @param {Array} row 行数组。
 * @param {number} columns 列数。
 */
function sanitizeRow(row, columns) {
  for (let column = 0; column < columns; column += 1) {
    const cell = row[column] || BLANK_CELL;
    if (cell.width === 0) {
      if (column === 0 || row[column - 1].width !== 2) {
        row[column] = BLANK_CELL;
      }
    } else if (cell.width === 2) {
      if (column + 1 >= columns || row[column + 1].width !== 0) {
        row[column] = BLANK_CELL;
      }
    }
  }
}

/**
 * 生成擦除用的空白单元格（保留当前背景色）。
 *
 * @param {Object} screen 屏幕对象。
 * @returns {Object} 空白单元格。
 */
function createEraseCell(screen) {
  if (screen.currentStyle === DEFAULT_STYLE) {
    return BLANK_CELL;
  }
  return { text: " ", width: 1, style: screen.currentStyle };
}

/**
 * 用空白填充一行中的指定列区间，并处理宽字符边界。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} rowIndex 行下标。
 * @param {number} startColumn 起始列（含）。
 * @param {number} endColumn 结束列（不含）。
 */
function fillRowRange(screen, rowIndex, startColumn, endColumn) {
  const row = screen.screenRows[rowIndex];
  if (!row) {
    return;
  }
  let from = Math.max(0, Math.min(screen.columns, Math.trunc(startColumn)));
  let to = Math.max(0, Math.min(screen.columns, Math.trunc(endColumn)));
  if (from >= to) {
    return;
  }
  if (from > 0 && row[from] && row[from].width === 0) {
    from -= 1;
  }
  if (to < screen.columns && row[to - 1] && row[to - 1].width === 2) {
    to += 1;
  }
  row.fill(createEraseCell(screen), from, to);
  screen.markRow(rowIndex);
}

/**
 * 擦除行内内容。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} mode 0=光标到行尾，1=行首到光标，2=整行。
 */
export function eraseInLine(screen, mode) {
  const row = screen.cursor.row;
  if (mode === 0) {
    fillRowRange(screen, row, screen.cursor.column, screen.columns);
  } else if (mode === 1) {
    fillRowRange(screen, row, 0, screen.cursor.column + 1);
  } else if (mode === 2) {
    fillRowRange(screen, row, 0, screen.columns);
  }
}

/**
 * 擦除屏幕内容。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} mode 0=光标到屏幕末尾，1=屏幕开头到光标，2=整屏，3=清空回看历史。
 */
export function eraseInDisplay(screen, mode) {
  if (mode === 0) {
    fillRowRange(screen, screen.cursor.row, screen.cursor.column, screen.columns);
    for (let row = screen.cursor.row + 1; row < screen.rows; row += 1) {
      fillRowRange(screen, row, 0, screen.columns);
    }
  } else if (mode === 1) {
    for (let row = 0; row < screen.cursor.row; row += 1) {
      fillRowRange(screen, row, 0, screen.columns);
    }
    fillRowRange(screen, screen.cursor.row, 0, screen.cursor.column + 1);
  } else if (mode === 2) {
    for (let row = 0; row < screen.rows; row += 1) {
      fillRowRange(screen, row, 0, screen.columns);
    }
    screen.clearRevision += 1;
  } else if (mode === 3) {
    clearScrollback(screen);
    screen.clearRevision += 1;
  }
}

/**
 * 清空回看历史。
 *
 * @param {Object} screen 屏幕对象。
 */
export function clearScrollback(screen) {
  screen.scrollback = [];
  screen.scrollbackGeneration += 1;
  screen.scrollbackAdded = 0;
  screen.scrollbackTrimmed = 0;
}

/**
 * 在光标处插入字符。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} count 数量。
 */
export function insertCharacters(screen, count = 1) {
  const amount = Math.max(1, Math.min(screen.columns, Math.trunc(count) || 1));
  const row = screen.screenRows[screen.cursor.row];
  row.splice(screen.cursor.column, 0, ...new Array(amount).fill(BLANK_CELL));
  row.length = screen.columns;
  sanitizeRow(row, screen.columns);
  screen.markRow(screen.cursor.row);
}

/**
 * 删除光标处的字符。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} count 数量。
 */
export function deleteCharacters(screen, count = 1) {
  const amount = Math.max(1, Math.min(screen.columns, Math.trunc(count) || 1));
  const row = screen.screenRows[screen.cursor.row];
  row.splice(screen.cursor.column, amount);
  while (row.length < screen.columns) {
    row.push(BLANK_CELL);
  }
  sanitizeRow(row, screen.columns);
  screen.markRow(screen.cursor.row);
}

/**
 * 擦除光标处的若干字符（不移动左侧内容）。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} count 数量。
 */
export function eraseCharacters(screen, count = 1) {
  const amount = Math.max(1, Math.trunc(count) || 1);
  const start = screen.cursor.column;
  const end = Math.min(screen.columns, start + amount);
  const row = screen.screenRows[screen.cursor.row];
  row.fill(createEraseCell(screen), start, end);
  sanitizeRow(row, screen.columns);
  screen.markRow(screen.cursor.row);
}

/**
 * 在光标处插入空行。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} count 数量。
 */
export function insertLines(screen, count = 1) {
  const amount = Math.max(1, Math.min(screen.rows, Math.trunc(count) || 1));
  for (let index = 0; index < amount; index += 1) {
    screen.screenRows.splice(screen.cursor.row, 0, screen.createBlankRow());
    screen.screenRows.pop();
  }
  screen.markRowsFrom(screen.cursor.row);
}

/**
 * 删除光标处的行。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} count 数量。
 */
export function deleteLines(screen, count = 1) {
  const amount = Math.max(1, Math.min(screen.rows, Math.trunc(count) || 1));
  for (let index = 0; index < amount; index += 1) {
    screen.screenRows.splice(screen.cursor.row, 1);
    screen.screenRows.push(screen.createBlankRow());
  }
  screen.markRowsFrom(screen.cursor.row);
}

/**
 * 向下滚动指定行数；滚出屏幕底部的行直接丢弃。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number} count 行数。
 */
export function scrollDown(screen, count = 1) {
  const amount = Math.max(1, Math.trunc(count) || 1);
  for (let index = 0; index < amount; index += 1) {
    screen.screenRows.pop();
    screen.screenRows.unshift(screen.createBlankRow());
  }
  screen.markAllDirty();
}

/**
 * 反向索引：光标上移，已在顶部时向下滚动。
 *
 * @param {Object} screen 屏幕对象。
 */
export function reverseIndex(screen) {
  screen.wrapPending = false;
  if (screen.cursor.row > 0) {
    screen.cursor.row -= 1;
  } else {
    scrollDown(screen, 1);
  }
}

/**
 * 进入备用屏幕（用于 vim、top 等全屏程序）。
 *
 * @param {Object} screen 屏幕对象。
 */
export function enterAlternateScreen(screen) {
  if (screen.alternateActive) {
    return;
  }
  screen.savedMainScreen = {
    rows: screen.screenRows,
    cursor: { ...screen.cursor },
    style: screen.currentStyle,
    wrapPending: screen.wrapPending,
    savedCursor: screen.savedCursor,
  };
  screen.alternateActive = true;
  screen.screenRows = screen.createBlankRows();
  screen.cursor = { row: 0, column: 0 };
  screen.wrapPending = false;
  screen.clearRevision += 1;
  screen.markAllDirty();
}

/**
 * 退出备用屏幕并恢复主屏幕。
 *
 * @param {Object} screen 屏幕对象。
 */
export function leaveAlternateScreen(screen) {
  if (!screen.alternateActive || !screen.savedMainScreen) {
    return;
  }
  const saved = screen.savedMainScreen;
  screen.savedMainScreen = null;
  screen.alternateActive = false;
  screen.screenRows = saved.rows;
  screen.cursor = saved.cursor;
  screen.currentStyle = saved.style;
  screen.wrapPending = saved.wrapPending;
  screen.savedCursor = saved.savedCursor;
  screen.clearRevision += 1;
  screen.markAllDirty();
}
