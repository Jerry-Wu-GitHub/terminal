/**
 * ANSI / VT100 转义序列解析器。
 *
 * 解析器只负责把字节流解码后的字符串划分为可打印文本与控制序列，
 * 然后调用 TerminalScreen 与 screen-editing 中的高层操作。状态机
 * 会跨多次 write 调用保持，因此即使一条转义序列被 WebSocket 分片，
 * 也能正确解析。
 */

import { applySgr } from "./style.js";
import {
  deleteCharacters,
  deleteLines,
  enterAlternateScreen,
  eraseCharacters,
  eraseInDisplay,
  eraseInLine,
  insertCharacters,
  insertLines,
  leaveAlternateScreen,
  reverseIndex,
  scrollDown,
} from "./screen-editing.js";

const STATE_GROUND = 0;
const STATE_ESCAPE = 1;
const STATE_CSI = 2;
const STATE_OSC = 3;
const STATE_STRING = 4;
const STATE_CHARSET = 5;

/**
 * 解析分号分隔的 CSI 参数。
 *
 * @param {string} text 参数字符串。
 * @returns {number[]} 参数列表。
 */
function parseParameters(text) {
  if (text === "") {
    return [];
  }
  return text.split(";").map((part) => {
    if (part === "") {
      return 0;
    }
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

/**
 * 读取指定位置的参数。
 *
 * @param {number[]} parameters 参数列表。
 * @param {number} index 下标。
 * @param {number} fallback 缺省值。
 * @returns {number} 参数值。
 */
function parameterAt(parameters, index, fallback) {
  const value = parameters[index];
  return value === undefined ? fallback : value;
}

/**
 * 读取数量类参数：0 或缺失时按 1 处理。
 *
 * @param {number[]} parameters 参数列表。
 * @param {number} index 下标。
 * @returns {number} 数量。
 */
function amountAt(parameters, index) {
  const value = parameters[index];
  return value && value > 0 ? value : 1;
}

/**
 * 应用私有模式（CSI ? ... h/l）。
 *
 * @param {Object} screen 屏幕对象。
 * @param {number[]} parameters 模式列表。
 * @param {boolean} enabled 是否开启。
 */
function applyPrivateModes(screen, parameters, enabled) {
  for (const mode of parameters) {
    if (mode === 1) {
      screen.applicationCursorKeys = enabled;
    } else if (mode === 7) {
      screen.autoWrap = enabled;
      if (!enabled) {
        screen.wrapPending = false;
      }
    } else if (mode === 25) {
      screen.cursorVisible = enabled;
    } else if (mode === 47 || mode === 1047 || mode === 1049) {
      if (enabled) {
        enterAlternateScreen(screen);
      } else {
        leaveAlternateScreen(screen);
      }
    } else if (mode === 2004) {
      screen.bracketPaste = enabled;
    }
  }
}

/**
 * ANSI 解析器。
 */
export class AnsiParser {
  /**
   * @param {Object} screen TerminalScreen 实例。
   * @param {{onBell?: Function}} [handlers] 事件回调。
   */
  constructor(screen, handlers = {}) {
    this.screen = screen;
    this.handlers = handlers;
    this.reset();
  }

  /** 清空解析状态。 */
  reset() {
    this.state = STATE_GROUND;
    this.printable = "";
    this.csiBuffer = "";
    this.oscBuffer = "";
    this.oscEscape = false;
    this.stringEscape = false;
  }

  /**
   * 解析一段文本。
   *
   * @param {string} text 文本。
   */
  write(text) {
    for (let index = 0; index < text.length; index += 1) {
      let character = text[index];
      const code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        const low = text.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          character += text[index + 1];
          index += 1;
        }
      }
      this.consume(character, code);
    }
    this.flushPrintable();
  }

  /** 输出并清空可打印文本缓冲区。 */
  flushPrintable() {
    if (this.printable !== "") {
      this.screen.printText(this.printable);
      this.printable = "";
    }
  }

  /**
   * 处理一个字符。
   *
   * @param {string} character 字符。
   * @param {number} code UTF-16 码元。
   */
  consume(character, code) {
    if (this.state === STATE_GROUND) {
      this.consumeGround(character, code);
    } else if (this.state === STATE_ESCAPE) {
      this.consumeEscape(character, code);
    } else if (this.state === STATE_CSI) {
      this.consumeCsi(character, code);
    } else if (this.state === STATE_OSC) {
      this.consumeOsc(character, code);
    } else if (this.state === STATE_STRING) {
      this.consumeString(character, code);
    } else {
      this.state = STATE_GROUND;
    }
  }

  /**
   * 处理普通文本状态。
   *
   * @param {string} character 字符。
   * @param {number} code UTF-16 码元。
   */
  consumeGround(character, code) {
    if (code === 0x1b) {
      this.flushPrintable();
      this.state = STATE_ESCAPE;
    } else if (code < 0x20 || code === 0x7f) {
      this.flushPrintable();
      this.handleControl(code);
    } else if (code >= 0x80 && code <= 0x9f) {
      this.flushPrintable();
    } else {
      this.printable += character;
    }
  }

  /**
   * 处理 ESC 后续字符。
   *
   * @param {string} character 字符。
   * @param {number} code UTF-16 码元。
   */
  consumeEscape(character, code) {
    this.state = STATE_GROUND;
    if (code === 0x1b) {
      this.state = STATE_ESCAPE;
    } else if (character === "[") {
      this.state = STATE_CSI;
      this.csiBuffer = "";
    } else if (character === "]") {
      this.state = STATE_OSC;
      this.oscBuffer = "";
      this.oscEscape = false;
    } else if (
      character === "P" ||
      character === "X" ||
      character === "^" ||
      character === "_"
    ) {
      this.state = STATE_STRING;
      this.stringEscape = false;
    } else if ("()*+-./%#\"".includes(character)) {
      this.state = STATE_CHARSET;
    } else if (character === "7") {
      this.screen.saveCursor();
    } else if (character === "8") {
      this.screen.restoreCursor();
    } else if (character === "D") {
      this.screen.lineFeed();
    } else if (character === "E") {
      this.screen.carriageReturn();
      this.screen.lineFeed();
    } else if (character === "M") {
      reverseIndex(this.screen);
    } else if (character === "c") {
      this.screen.reset();
    }
  }

  /**
   * 处理 CSI 序列（ESC [ ...）。
   *
   * @param {string} character 字符。
   * @param {number} code UTF-16 码元。
   */
  consumeCsi(character, code) {
    if (code === 0x1b) {
      this.state = STATE_ESCAPE;
      return;
    }
    if (code < 0x20) {
      this.handleControl(code);
      return;
    }
    if (code >= 0x40 && code <= 0x7e) {
      this.handleCsi(this.csiBuffer, character);
      this.state = STATE_GROUND;
      return;
    }
    if (code >= 0x20 && code <= 0x3f) {
      if (this.csiBuffer.length < 512) {
        this.csiBuffer += character;
      }
    }
  }

  /**
   * 处理 OSC 字符串（ESC ] ...）。
   *
   * @param {string} character 字符。
   * @param {number} code UTF-16 码元。
   */
  consumeOsc(character, code) {
    if (code === 0x07) {
      this.state = STATE_GROUND;
      return;
    }
    if (code === 0x1b) {
      this.oscEscape = true;
      return;
    }
    if (this.oscEscape) {
      this.oscEscape = false;
      if (character === "\\") {
        this.state = STATE_GROUND;
      }
      return;
    }
    if (this.oscBuffer.length < 512) {
      this.oscBuffer += character;
    }
  }

  /**
   * 处理 DCS / APC / PM / SOS 字符串，直接忽略到 ST 为止。
   *
   * @param {string} character 字符。
   * @param {number} code UTF-16 码元。
   */
  consumeString(character, code) {
    if (code === 0x1b) {
      this.stringEscape = true;
      return;
    }
    if (this.stringEscape) {
      this.stringEscape = false;
      if (character === "\\") {
        this.state = STATE_GROUND;
      }
    }
  }

  /**
   * 处理 C0 控制字符。
   *
   * @param {number} code UTF-16 码元。
   */
  handleControl(code) {
    if (code === 0x07) {
      if (typeof this.handlers.onBell === "function") {
        this.handlers.onBell();
      }
    } else if (code === 0x08) {
      this.screen.backspace();
    } else if (code === 0x09) {
      this.screen.tab();
    } else if (code === 0x0a || code === 0x0b || code === 0x0c) {
      this.screen.lineFeed();
    } else if (code === 0x0d) {
      this.screen.carriageReturn();
    }
  }

  /**
   * 执行一条 CSI 序列。
   *
   * @param {string} buffer 参数字符串。
   * @param {string} finalCharacter 终止字符。
   */
  handleCsi(buffer, finalCharacter) {
    const match = buffer.match(/^([?>!=]?)([0-9;]*)/);
    if (!match) {
      return;
    }
    const privatePrefix = match[1];
    const parameterText = match[2];
    const parameters = parseParameters(parameterText);
    const isPrivate = privatePrefix === "?";
    const screen = this.screen;

    if (finalCharacter === "m") {
      if (!privatePrefix) {
        screen.setStyle(applySgr(screen.currentStyle, parameterText));
      }
      return;
    }

    if (finalCharacter === "h" || finalCharacter === "l") {
      if (isPrivate) {
        applyPrivateModes(screen, parameters, finalCharacter === "h");
      }
      return;
    }

    if (finalCharacter === "H" || finalCharacter === "f") {
      screen.moveCursorTo(
        (parameterAt(parameters, 0, 1) || 1) - 1,
        (parameterAt(parameters, 1, 1) || 1) - 1
      );
    } else if (finalCharacter === "A") {
      screen.moveCursorBy(-amountAt(parameters, 0), 0);
    } else if (finalCharacter === "B" || finalCharacter === "e") {
      screen.moveCursorBy(amountAt(parameters, 0), 0);
    } else if (finalCharacter === "C" || finalCharacter === "a") {
      screen.moveCursorBy(0, amountAt(parameters, 0));
    } else if (finalCharacter === "D") {
      screen.moveCursorBy(0, -amountAt(parameters, 0));
    } else if (finalCharacter === "E") {
      screen.moveCursorTo(screen.cursor.row + amountAt(parameters, 0), 0);
    } else if (finalCharacter === "F") {
      screen.moveCursorTo(screen.cursor.row - amountAt(parameters, 0), 0);
    } else if (finalCharacter === "G" || finalCharacter === "`") {
      screen.moveCursorTo(
        screen.cursor.row,
        (parameterAt(parameters, 0, 1) || 1) - 1
      );
    } else if (finalCharacter === "d") {
      screen.moveCursorTo(
        (parameterAt(parameters, 0, 1) || 1) - 1,
        screen.cursor.column
      );
    } else if (finalCharacter === "J") {
      eraseInDisplay(screen, parameterAt(parameters, 0, 0));
    } else if (finalCharacter === "K") {
      eraseInLine(screen, parameterAt(parameters, 0, 0));
    } else if (finalCharacter === "L") {
      insertLines(screen, amountAt(parameters, 0));
    } else if (finalCharacter === "M") {
      deleteLines(screen, amountAt(parameters, 0));
    } else if (finalCharacter === "P") {
      deleteCharacters(screen, amountAt(parameters, 0));
    } else if (finalCharacter === "@") {
      insertCharacters(screen, amountAt(parameters, 0));
    } else if (finalCharacter === "X") {
      eraseCharacters(screen, amountAt(parameters, 0));
    } else if (finalCharacter === "S") {
      screen.scrollUp(amountAt(parameters, 0));
    } else if (finalCharacter === "T") {
      scrollDown(screen, amountAt(parameters, 0));
    } else if (finalCharacter === "Z") {
      screen.tabBackward(amountAt(parameters, 0));
    } else if (finalCharacter === "s" && !privatePrefix) {
      screen.saveCursor();
    } else if (finalCharacter === "u" && !privatePrefix) {
      screen.restoreCursor();
    } else if (finalCharacter === "b" && !privatePrefix) {
      // REP：重复上一个字符，很少有程序使用，忽略。
    }
  }
}
