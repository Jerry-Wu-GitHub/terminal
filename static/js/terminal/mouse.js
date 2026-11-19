/**
 * 鼠标事件到终端鼠标协议的编码。
 *
 * 支持 DEC 私有模式 9 / 1000 / 1001 / 1002 / 1003 规定的追踪方式，
 * 以及 X10（默认）、UTF-8（1005）、SGR（1006）、urxvt（1015）四种
 * 坐标编码。编码结果是可直接写入 PTY 的字节串。
 */

const ESC = 0x1b;

/** 终端鼠标协议的按钮编号。 */
const BUTTON_LEFT = 0;
const BUTTON_MIDDLE = 1;
const BUTTON_RIGHT = 2;
const BUTTON_RELEASE = 3;
const BUTTON_WHEEL_UP = 64;
const BUTTON_WHEEL_DOWN = 65;
const BUTTON_WHEEL_LEFT = 66;
const BUTTON_WHEEL_RIGHT = 67;

/** 鼠标移动标志位。 */
const MOTION_FLAG = 32;

/** 传统 X10 协议坐标上限（32 + 223 = 255）。 */
const MAX_CLASSIC_COORDINATE = 223;

/** UTF-8 扩展坐标上限（32 + 2015 = 2047）。 */
const MAX_UTF8_COORDINATE = 2015;

const encoder = new TextEncoder();

/**
 * 计算修饰键对应的协议位。
 *
 * @param {Object} event 鼠标事件（或其快照）。
 * @returns {number} 修饰键位掩码。
 */
function modifierBits(event) {
  let bits = 0;
  if (event.shiftKey) {
    bits |= 4;
  }
  if (event.altKey || event.metaKey) {
    bits |= 8;
  }
  if (event.ctrlKey) {
    bits |= 16;
  }
  return bits;
}

/**
 * 取按下的最低位按钮编号；没有按钮时返回 3。
 *
 * @param {number} mask 终端按钮位掩码。
 * @returns {number} 按钮编号。
 */
function lowestButton(mask) {
  if (mask & (1 << BUTTON_LEFT)) {
    return BUTTON_LEFT;
  }
  if (mask & (1 << BUTTON_MIDDLE)) {
    return BUTTON_MIDDLE;
  }
  if (mask & (1 << BUTTON_RIGHT)) {
    return BUTTON_RIGHT;
  }
  return BUTTON_RELEASE;
}

/**
 * 把滚轮滚动量转换为按钮编号。
 *
 * @param {number} deltaX 水平滚动量。
 * @param {number} deltaY 垂直滚动量。
 * @returns {number|null} 按钮编号；没有滚动时返回 null。
 */
export function wheelButtonCode(deltaX, deltaY) {
  if (deltaY < 0) {
    return BUTTON_WHEEL_UP;
  }
  if (deltaY > 0) {
    return BUTTON_WHEEL_DOWN;
  }
  if (deltaX < 0) {
    return BUTTON_WHEEL_LEFT;
  }
  if (deltaX > 0) {
    return BUTTON_WHEEL_RIGHT;
  }
  return null;
}

/**
 * 判断当前追踪模式是否会上报移动事件。
 *
 * @param {number} mode 追踪模式。
 * @param {number} buttons 终端按钮位掩码。
 * @returns {boolean} 是否上报。
 */
function motionAllowed(mode, buttons) {
  if (mode === 1003) {
    return true;
  }
  if (mode === 1002) {
    return buttons !== 0;
  }
  return false;
}

/**
 * 构造传统 X10 编码（6 个原始字节）。
 *
 * @param {number} code 按钮编号。
 * @param {number} column 列号（1 起始）。
 * @param {number} row 行号（1 起始）。
 * @returns {Uint8Array} 字节串。
 */
function encodeClassic(code, column, row) {
  const clamp = (value) =>
    Math.max(32, Math.min(255, Math.trunc(value) + 32));
  return new Uint8Array([
    ESC,
    0x5b,
    0x4d,
    clamp(code),
    clamp(Math.min(column, MAX_CLASSIC_COORDINATE)),
    clamp(Math.min(row, MAX_CLASSIC_COORDINATE)),
  ]);
}

/**
 * 构造 UTF-8 扩展编码（1005）。
 *
 * @param {number} code 按钮编号。
 * @param {number} column 列号（1 起始）。
 * @param {number} row 行号（1 起始）。
 * @returns {Uint8Array} 字节串。
 */
function encodeUtf8(code, column, row) {
  const values = [
    code,
    Math.min(column, MAX_UTF8_COORDINATE),
    Math.min(row, MAX_UTF8_COORDINATE),
  ];
  let text = "\x1b[M";
  for (const value of values) {
    text += String.fromCodePoint(Math.trunc(value) + 32);
  }
  return encoder.encode(text);
}

/**
 * 将鼠标事件编码为终端协议字节串。
 *
 * @param {Object} screen 屏幕对象（读取 mouseTrackingMode / mouseEncoding）。
 * @param {Object} event 事件描述。
 * @param {"press"|"release"|"motion"|"wheel"} event.kind 事件类型。
 * @param {number} [event.button] 按钮编号（按下、释放与滚轮使用）。
 * @param {number} [event.buttons] 当前按下的终端按钮位掩码。
 * @param {number} event.column 列号（0 起始）。
 * @param {number} event.row 行号（0 起始）。
 * @param {boolean} [event.shiftKey] 是否按下 Shift。
 * @param {boolean} [event.altKey] 是否按下 Alt。
 * @param {boolean} [event.metaKey] 是否按下 Meta。
 * @param {boolean} [event.ctrlKey] 是否按下 Ctrl。
 * @returns {Uint8Array|null} 协议字节串；无需上报时返回 null。
 */
export function encodeMouseEvent(screen, event) {
  const mode = screen.mouseTrackingMode || 0;
  if (mode === 0) {
    return null;
  }

  const buttons = event.buttons || 0;
  if (event.kind === "motion" && !motionAllowed(mode, buttons)) {
    return null;
  }
  if (mode === 9 && event.kind !== "press" && event.kind !== "wheel") {
    return null;
  }

  const modifiers = modifierBits(event);
  const button = event.button || 0;
  let code = button;
  let final = "M";

  if (event.kind === "release") {
    code = BUTTON_RELEASE;
    if (screen.mouseEncoding === "sgr") {
      code = button;
      final = "m";
    }
  } else if (event.kind === "motion") {
    code = MOTION_FLAG + lowestButton(buttons);
  }
  code += modifiers;

  const column = Math.max(0, Math.trunc(event.column) || 0);
  const row = Math.max(0, Math.trunc(event.row) || 0);
  const cx = column + 1;
  const cy = row + 1;

  if (screen.mouseEncoding === "sgr") {
    return encoder.encode(`\x1b[<${code};${cx};${cy}${final}`);
  }
  if (screen.mouseEncoding === "urxvt") {
    return encoder.encode(`\x1b[${code};${cx};${cy}M`);
  }
  if (screen.mouseEncoding === "utf8") {
    return encodeUtf8(code, cx, cy);
  }
  return encodeClassic(code, cx, cy);
}
