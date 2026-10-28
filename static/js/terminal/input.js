/**
 * 键盘事件到终端字节序列的映射。
 *
 * 只做纯计算，不直接发送数据；调用方根据返回的动作决定发送、复制或
 * 放行浏览器的粘贴事件。
 */

/**
 * 构造“发送数据”动作。
 *
 * @param {string} text 要发送的文本。
 * @returns {{type: string, text: string}} 动作对象。
 */
function dataAction(text) {
  return { type: "data", text };
}

/** 普通方向键序列。 */
const CURSOR_KEYS = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
};

/** 应用光标模式（DECCKM）下的方向键序列。 */
const APPLICATION_CURSOR_KEYS = {
  ArrowUp: "\x1bOA",
  ArrowDown: "\x1bOB",
  ArrowRight: "\x1bOC",
  ArrowLeft: "\x1bOD",
};

/** F5-F12 序列。 */
const FUNCTION_KEYS = {
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

/**
 * 把键盘事件解析为动作。
 *
 * @param {KeyboardEvent} event 键盘事件。
 * @param {Object} screen 屏幕对象（读取应用光标键模式）。
 * @param {boolean} hasSelection 终端内是否有选中文本。
 * @returns {{type: string, text?: string}|null} 动作；null 表示不处理。
 */
export function resolveKeyAction(event, screen, hasSelection) {
  if (event.isComposing || event.keyCode === 229) {
    return null;
  }

  const key = event.key;
  if (!key || key === "Process" || key === "Unidentified") {
    return null;
  }

  const isAltGraph =
    typeof event.getModifierState === "function" &&
    event.getModifierState("AltGraph");
  const commandKey = event.ctrlKey || event.metaKey;

  if (isAltGraph && key.length === 1) {
    return dataAction(key);
  }

  if (commandKey && (key === "v" || key === "V")) {
    return { type: "paste" };
  }

  if (event.metaKey && (key === "c" || key === "C")) {
    return hasSelection ? { type: "copy" } : null;
  }

  if (event.ctrlKey && event.shiftKey && (key === "c" || key === "C")) {
    return hasSelection ? { type: "copy" } : null;
  }

  if (event.metaKey) {
    return null;
  }

  if (event.ctrlKey && event.key === " ") {
    return dataAction("\x00");
  }

  if (event.ctrlKey && !event.altKey && key.length === 1) {
    const upperCode = key.toUpperCase().charCodeAt(0);
    if (upperCode >= 0x40 && upperCode <= 0x5f) {
      return dataAction(String.fromCharCode(upperCode - 0x40));
    }
    const characterCode = key.charCodeAt(0);
    if (characterCode >= 0x20 && characterCode <= 0x3f) {
      return dataAction(String.fromCharCode(characterCode & 0x1f));
    }
  }

  if (event.altKey && !event.ctrlKey && key.length === 1) {
    return dataAction(`\x1b${key}`);
  }

  if (key === "Enter") {
    return dataAction("\r");
  }
  if (key === "Tab") {
    return dataAction(event.shiftKey ? "\x1b[Z" : "\t");
  }
  if (key === "Backspace") {
    return dataAction("\x7f");
  }
  if (key === "Escape") {
    return dataAction("\x1b");
  }
  if (key === "Insert") {
    if (event.shiftKey) {
      return { type: "paste" };
    }
    if (event.ctrlKey && hasSelection) {
      return { type: "copy" };
    }
    return dataAction("\x1b[2~");
  }
  if (key === "Delete") {
    return dataAction("\x1b[3~");
  }
  if (key === "PageUp") {
    return dataAction("\x1b[5~");
  }
  if (key === "PageDown") {
    return dataAction("\x1b[6~");
  }
  if (key === "Home") {
    return dataAction(screen.applicationCursorKeys ? "\x1bOH" : "\x1b[H");
  }
  if (key === "End") {
    return dataAction(screen.applicationCursorKeys ? "\x1bOF" : "\x1b[F");
  }
  if (CURSOR_KEYS[key]) {
    return dataAction(
      screen.applicationCursorKeys
        ? APPLICATION_CURSOR_KEYS[key]
        : CURSOR_KEYS[key]
    );
  }
  if (FUNCTION_KEYS[key]) {
    return dataAction(FUNCTION_KEYS[key]);
  }
  if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
    return dataAction(key);
  }
  return null;
}
