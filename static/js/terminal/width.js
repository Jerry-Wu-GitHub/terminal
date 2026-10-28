/**
 * 字符显示宽度计算。
 *
 * 终端网格以“列”为单位：普通英文字符占 1 列，CJK 与 emoji 占 2 列，
 * 组合附加符号不占列。这里用 Unicode 码点范围做近似判断。
 */

/** 东亚宽字符与 emoji 的码点范围。 */
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18d08],
  [0x1b000, 0x1b2ff],
  [0x1f000, 0x1faff],
  [0x1f1e6, 0x1f1ff],
  [0x20000, 0x3fffd],
];

/** Unicode 组合附加符号。 */
const COMBINING_MARK = /\p{M}/u;

/**
 * 判断码点是否为宽字符。
 *
 * @param {number} codePoint Unicode 码点。
 * @returns {boolean} 宽度是否为 2。
 */
function isWideCodePoint(codePoint) {
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

/**
 * 判断字符是否不占列（组合符号、零宽字符、变体选择符等）。
 *
 * @param {string} character 单个 Unicode 字符。
 * @param {number} codePoint 该字符的码点。
 * @returns {boolean} 是否为零宽。
 */
function isZeroWidth(character, codePoint) {
  if (codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d) {
    return true;
  }
  if (codePoint === 0x2060 || codePoint === 0xfeff) {
    return true;
  }
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) {
    return true;
  }
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) {
    return true;
  }
  return COMBINING_MARK.test(character);
}

/**
 * 返回单个字符的显示宽度。
 *
 * @param {string} character 单个 Unicode 字符。
 * @returns {0|1|2} 占用的列数。
 */
export function getCharacterWidth(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
    return 0;
  }
  if (isZeroWidth(character, codePoint)) {
    return 0;
  }
  return isWideCodePoint(codePoint) ? 2 : 1;
}

/**
 * 返回一个字素簇（grapheme）的显示宽度。
 *
 * 组合字符、emoji 修饰符、ZWJ 序列都作为整体计算，取内部字符的最大
 * 宽度；带变体选择符 FE0F 的字符按 emoji 展示，占 2 列。
 *
 * @param {string} cluster 字素簇。
 * @returns {0|1|2} 占用的列数。
 */
export function getClusterWidth(cluster) {
  let width = 0;
  let emojiPresentation = false;
  for (const character of cluster) {
    if (character.codePointAt(0) === 0xfe0f) {
      emojiPresentation = true;
    }
    width = Math.max(width, getCharacterWidth(character));
  }
  if (emojiPresentation && width === 1) {
    return 2;
  }
  return width;
}
