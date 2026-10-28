/**
 * 界面文本格式化工具。
 */

/**
 * 把数字补齐为两位字符串。
 *
 * @param {number} value 数值。
 * @returns {string} 两位字符串。
 */
function padTwoDigits(value) {
  return String(value).padStart(2, "0");
}

/**
 * 把 10 位秒级时间戳格式化为 `年/月/日 时:分:秒`。
 *
 * @param {number|null} timestamp 秒级 Unix 时间戳。
 * @returns {string} 格式化后的时间；无效时返回破折号。
 */
export function formatExpiry(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "\u2014";
  }
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return "\u2014";
  }
  const year = date.getFullYear();
  const month = padTwoDigits(date.getMonth() + 1);
  const day = padTwoDigits(date.getDate());
  const hour = padTwoDigits(date.getHours());
  const minute = padTwoDigits(date.getMinutes());
  const second = padTwoDigits(date.getSeconds());
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}
