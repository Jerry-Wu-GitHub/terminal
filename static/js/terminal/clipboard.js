/**
 * 剪贴板读写与终端选区辅助。
 *
 * 优先使用异步 Clipboard API；在非安全上下文（如局域网 HTTP）中
 * 退化为 execCommand 方案。读取失败时返回 null，由调用方提示用户。
 */

/**
 * 使用隐藏 textarea 与 execCommand 复制文本。
 *
 * @param {string} text 要复制的文本。
 * @returns {boolean} 是否成功。
 */
function copyWithExecCommand(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  area.style.top = "0";
  document.body.appendChild(area);
  area.select();
  let success = false;
  try {
    success = document.execCommand("copy");
  } catch (error) {
    success = false;
  }
  area.remove();
  return success;
}

/**
 * 使用隐藏 textarea 与 execCommand 读取剪贴板。
 *
 * @returns {string|null} 读取到的文本；失败时返回 null。
 */
function readWithExecCommand() {
  const area = document.createElement("textarea");
  area.value = "";
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  area.style.top = "0";
  document.body.appendChild(area);
  area.focus();
  let success = false;
  try {
    success = document.execCommand("paste");
  } catch (error) {
    success = false;
  }
  const text = area.value;
  area.remove();
  return success ? text : null;
}

/**
 * 把文本写入剪贴板。
 *
 * @param {string} text 文本。
 * @returns {Promise<boolean>} 是否成功。
 */
export async function writeClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // 权限被拒绝或不在安全上下文，尝试退化方案。
    }
  }
  return copyWithExecCommand(text);
}

/**
 * 从剪贴板读取文本。
 *
 * @returns {Promise<string|null>} 文本；失败时返回 null。
 */
export async function readClipboard() {
  if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      // 权限被拒绝或不在安全上下文，尝试退化方案。
    }
  }
  return readWithExecCommand();
}

/**
 * 获取指定元素内部当前选中的文本。
 *
 * @param {HTMLElement} element 目标元素。
 * @returns {string} 选中文本；没有选区或选区在元素外时返回空串。
 */
export function getSelectionWithin(element) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return "";
  }
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) {
    return "";
  }
  return selection.toString();
}
