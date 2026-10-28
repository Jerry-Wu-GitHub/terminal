/**
 * 全局提示（Toast）。
 *
 * 提供信息、成功、错误三类提示，统一挂载到 #toast-container，
 * 自动淡出，最多同时保留三条，避免刷屏。
 */

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION = 3200;
const ERROR_DURATION = 5000;
const FADE_OUT_DURATION = 200;

/** 常见业务错误码对应的友好文案。 */
const FRIENDLY_MESSAGES = {
  TERMINAL_NOT_FOUND: "Terminal 不存在或已过期",
  INTERNAL_SERVER_ERROR: "服务器内部错误",
  NETWORK_ERROR: "无法连接到服务器",
  TIMEOUT: "请求超时",
  INVALID_RESPONSE: "服务器响应格式不正确",
};

/**
 * 从任意错误对象中提取可读文案。
 *
 * @param {*} error 错误对象或字符串。
 * @returns {string} 可读文案。
 */
export function extractErrorMessage(error) {
  if (!error) {
    return "未知错误";
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error.code === "string" && FRIENDLY_MESSAGES[error.code]) {
    return `${FRIENDLY_MESSAGES[error.code]}（${error.code}）`;
  }
  if (typeof error.code === "string" && typeof error.message === "string") {
    return `${error.message}（${error.code}）`;
  }
  if (typeof error.message === "string" && error.message !== "") {
    return error.message;
  }
  return "未知错误";
}

/**
 * 获取或创建提示容器。
 *
 * @returns {HTMLElement} 容器元素。
 */
function getContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 移除单条提示，带淡出动画。
 *
 * @param {HTMLElement} element 提示元素。
 */
function dismiss(element) {
  if (!element.isConnected) {
    return;
  }
  element.classList.add("is-hiding");
  window.setTimeout(() => element.remove(), FADE_OUT_DURATION);
}

/**
 * 展示一条提示。
 *
 * @param {string} message 提示文案。
 * @param {"info"|"success"|"error"} [type] 提示类型。
 * @param {number} [duration] 展示时长（毫秒）。
 * @returns {HTMLElement|null} 提示元素。
 */
export function showToast(message, type = "info", duration = DEFAULT_DURATION) {
  const container = getContainer();
  while (container.children.length >= MAX_VISIBLE_TOASTS) {
    container.firstElementChild?.remove();
  }

  const element = document.createElement("div");
  element.className = "toast";
  if (type === "error") {
    element.classList.add("toast--error");
  } else if (type === "success") {
    element.classList.add("toast--success");
  }
  element.textContent = String(message);
  element.addEventListener("click", () => dismiss(element));
  container.appendChild(element);

  if (duration > 0) {
    window.setTimeout(() => dismiss(element), duration);
  }
  return element;
}

/**
 * 展示信息提示。
 *
 * @param {string} message 提示文案。
 * @returns {HTMLElement|null} 提示元素。
 */
export function showInfo(message) {
  return showToast(message, "info", DEFAULT_DURATION);
}

/**
 * 展示成功提示。
 *
 * @param {string} message 提示文案。
 * @returns {HTMLElement|null} 提示元素。
 */
export function showSuccess(message) {
  return showToast(message, "success", DEFAULT_DURATION);
}

/**
 * 展示错误提示。
 *
 * @param {*} error 错误对象或字符串。
 * @returns {HTMLElement|null} 提示元素。
 */
export function showError(error) {
  return showToast(extractErrorMessage(error), "error", ERROR_DURATION);
}
