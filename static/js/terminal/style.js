/**
 * SGR 文本样式与颜色解析。
 *
 * 每个单元格保存一个不可变的样式对象引用；SGR 序列产生新的样式对象，
 * 渲染器按引用分组，即可高效地把连续同样式字符合并为同一个 span。
 */

import {
  ANSI_BRIGHT_COLORS,
  ANSI_NORMAL_COLORS,
  DEFAULT_BACKGROUND,
  DEFAULT_FOREGROUND,
} from "../config.js";

/** 默认样式（无任何修饰）。 */
export const DEFAULT_STYLE = Object.freeze({
  foreground: null,
  background: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  inverse: false,
  hidden: false,
  strike: false,
});

/** 样式到渲染属性的缓存，避免重复计算。 */
const resolvedStyleCache = new WeakMap();

/**
 * 判断样式是否等于默认样式。
 *
 * @param {Object} style 样式对象。
 * @returns {boolean} 是否无任何修饰。
 */
function isDefaultStyle(style) {
  return (
    style.foreground === null &&
    style.background === null &&
    !style.bold &&
    !style.dim &&
    !style.italic &&
    !style.underline &&
    !style.blink &&
    !style.inverse &&
    !style.hidden &&
    !style.strike
  );
}

/**
 * 把 256 色立方体的分量转换为 0-255 的亮度。
 *
 * @param {number} level 分量级别（0-5）。
 * @returns {number} 亮度值。
 */
function colorComponent(level) {
  return level === 0 ? 0 : 55 + level * 40;
}

/**
 * 把 256 色索引转换为 CSS 颜色。
 *
 * @param {number} index 颜色索引（0-255）。
 * @param {boolean} bold 是否加粗（0-7 的基础色会提亮）。
 * @param {boolean} isForeground 是否用于前景色。
 * @returns {string} CSS 颜色。
 */
function paletteColor(index, bold, isForeground) {
  let normalizedIndex = Math.max(0, Math.min(255, Math.trunc(index) || 0));
  if (isForeground && bold && normalizedIndex < 8) {
    normalizedIndex += 8;
  }
  if (normalizedIndex < 8) {
    return ANSI_NORMAL_COLORS[normalizedIndex];
  }
  if (normalizedIndex < 16) {
    return ANSI_BRIGHT_COLORS[normalizedIndex - 8];
  }
  if (normalizedIndex < 232) {
    const value = normalizedIndex - 16;
    const red = Math.floor(value / 36);
    const green = Math.floor((value % 36) / 6);
    const blue = value % 6;
    return `rgb(${colorComponent(red)}, ${colorComponent(green)}, ${colorComponent(blue)})`;
  }
  const gray = 8 + (normalizedIndex - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

/**
 * 把颜色描述符解析为 CSS 颜色。
 *
 * @param {{type: string, index?: number, red?: number, green?: number, blue?: number}|null} descriptor 颜色描述符。
 * @param {boolean} bold 当前是否加粗。
 * @param {boolean} isForeground 是否用于前景色。
 * @returns {string|null} CSS 颜色；未指定时返回 null。
 */
function resolveColor(descriptor, bold, isForeground) {
  if (!descriptor) {
    return null;
  }
  if (descriptor.type === "rgb") {
    const red = Math.max(0, Math.min(255, descriptor.red));
    const green = Math.max(0, Math.min(255, descriptor.green));
    const blue = Math.max(0, Math.min(255, descriptor.blue));
    return `rgb(${red}, ${green}, ${blue})`;
  }
  return paletteColor(descriptor.index, bold, isForeground);
}

/**
 * 解析扩展颜色参数（38/48/58 后面的 5;n 或 2;r;g;b）。
 *
 * @param {number[]} parameters SGR 参数列表。
 * @param {number} startIndex 扩展颜色起始下标。
 * @returns {{descriptor: Object|null, lastIndex: number}} 颜色描述符与消费到的下标。
 */
function parseExtendedColor(parameters, startIndex) {
  const kind = parameters[startIndex + 1];
  if (kind === 5) {
    const index = parameters[startIndex + 2] ?? 0;
    return {
      descriptor: { type: "palette", index },
      lastIndex: startIndex + 2,
    };
  }
  if (kind === 2) {
    const red = parameters[startIndex + 2] ?? 0;
    const green = parameters[startIndex + 3] ?? 0;
    const blue = parameters[startIndex + 4] ?? 0;
    return {
      descriptor: { type: "rgb", red, green, blue },
      lastIndex: startIndex + 4,
    };
  }
  return { descriptor: null, lastIndex: startIndex };
}

/**
 * 应用一段 SGR 参数，返回新的不可变样式对象。
 *
 * @param {Object} currentStyle 当前样式。
 * @param {string} parameterText 分号分隔的 SGR 参数字符串。
 * @returns {Object} 新样式对象。
 */
export function applySgr(currentStyle, parameterText) {
  const text = parameterText.trim();
  if (text === "") {
    return DEFAULT_STYLE;
  }

  const parameters = text.split(";").map((part) => {
    if (part === "") {
      return 0;
    }
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });

  const style = { ...currentStyle };

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];

    if (parameter === 38 || parameter === 48 || parameter === 58) {
      const extended = parseExtendedColor(parameters, index);
      if (extended.descriptor && parameter === 38) {
        style.foreground = extended.descriptor;
      } else if (extended.descriptor && parameter === 48) {
        style.background = extended.descriptor;
      }
      index = extended.lastIndex;
      continue;
    }

    if (parameter === 0) {
      Object.assign(style, DEFAULT_STYLE);
    } else if (parameter === 1) {
      style.bold = true;
    } else if (parameter === 2) {
      style.dim = true;
    } else if (parameter === 3) {
      style.italic = true;
    } else if (parameter === 4) {
      style.underline = true;
    } else if (parameter === 5) {
      style.blink = true;
    } else if (parameter === 7) {
      style.inverse = true;
    } else if (parameter === 8) {
      style.hidden = true;
    } else if (parameter === 9) {
      style.strike = true;
    } else if (parameter === 21 || parameter === 22) {
      style.bold = false;
      style.dim = false;
    } else if (parameter === 23) {
      style.italic = false;
    } else if (parameter === 24) {
      style.underline = false;
    } else if (parameter === 25) {
      style.blink = false;
    } else if (parameter === 27) {
      style.inverse = false;
    } else if (parameter === 28) {
      style.hidden = false;
    } else if (parameter === 29) {
      style.strike = false;
    } else if (parameter >= 30 && parameter <= 37) {
      style.foreground = { type: "palette", index: parameter - 30 };
    } else if (parameter === 39) {
      style.foreground = null;
    } else if (parameter >= 40 && parameter <= 47) {
      style.background = { type: "palette", index: parameter - 40 };
    } else if (parameter === 49) {
      style.background = null;
    } else if (parameter >= 90 && parameter <= 97) {
      style.foreground = { type: "palette", index: parameter - 90 + 8 };
    } else if (parameter >= 100 && parameter <= 107) {
      style.background = { type: "palette", index: parameter - 100 + 8 };
    }
  }

  return isDefaultStyle(style) ? DEFAULT_STYLE : style;
}

/**
 * 把样式解析为可直接应用到 DOM 的属性。
 *
 * 返回 null 表示无需任何额外样式；结果会被缓存，因为样式对象不可变。
 *
 * @param {Object} style 样式对象。
 * @returns {{color: string|null, backgroundColor: string|null, fontWeight: string|null, fontStyle: string|null, opacity: string|null, textDecoration: string|null, blink: boolean}|null} 渲染属性。
 */
export function resolveStyle(style) {
  if (!style || style === DEFAULT_STYLE) {
    return null;
  }
  if (resolvedStyleCache.has(style)) {
    return resolvedStyleCache.get(style);
  }

  let foreground = resolveColor(style.foreground, style.bold, true);
  let background = resolveColor(style.background, false, false);

  if (style.inverse) {
    const nextForeground = background || DEFAULT_BACKGROUND;
    const nextBackground = foreground || DEFAULT_FOREGROUND;
    foreground = nextForeground;
    background = nextBackground;
  }

  if (style.hidden) {
    foreground = background || DEFAULT_BACKGROUND;
  }

  const decorations = [];
  if (style.underline) {
    decorations.push("underline");
  }
  if (style.strike) {
    decorations.push("line-through");
  }

  const resolved = {
    color: foreground,
    backgroundColor: background,
    fontWeight: style.bold ? "700" : null,
    fontStyle: style.italic ? "italic" : null,
    opacity: style.dim ? "0.6" : null,
    textDecoration: decorations.length ? decorations.join(" ") : null,
    blink: style.blink,
  };

  resolvedStyleCache.set(style, resolved);
  return resolved;
}
