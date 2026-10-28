/**
 * HTTP 客户端。
 *
 * 统一封装 fetch：拼接接口地址、解析统一响应外壳 ApiResponse /
 * ErrorResponse、把错误转为带 code / message / details / status 的
 * ApiError，并负责请求超时。
 */

import { REQUEST_TIMEOUT_MILLISECONDS } from "../config.js";

/**
 * 业务请求错误。
 */
export class ApiError extends Error {
  /**
   * @param {string} code 业务错误码。
   * @param {string} message 人类可读的错误提示。
   * @param {Object|null} details 附加详情。
   * @param {number} status HTTP 状态码，网络层错误为 0。
   */
  constructor(code, message, details = null, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

/**
 * 把响应体解析为业务错误并抛出。
 *
 * @param {Response} response 原始响应。
 * @returns {Promise<never>} 始终抛出 ApiError。
 */
async function throwResponseError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (parseError) {
    payload = null;
  }

  if (payload && typeof payload.code === "string") {
    throw new ApiError(
      payload.code,
      payload.message || "请求失败",
      payload.details || null,
      response.status
    );
  }

  throw new ApiError(
    "HTTP_ERROR",
    `请求失败：HTTP ${response.status}`,
    null,
    response.status
  );
}

/**
 * 发送一个 HTTP 请求并返回响应外壳中的 data。
 *
 * @param {string} method HTTP 方法。
 * @param {string|URL} url 完整请求地址。
 * @param {Object|null} [body] JSON 请求体。
 * @returns {Promise<*>} 业务数据；204 时返回 null。
 */
export async function requestJson(method, url, body = null) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MILLISECONDS
  );

  const options = {
    method,
    signal: controller.signal,
    headers: {},
  };
  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (networkError) {
    if (networkError.name === "AbortError") {
      throw new ApiError("TIMEOUT", "请求超时", null, 0);
    }
    throw new ApiError(
      "NETWORK_ERROR",
      networkError.message || "网络请求失败",
      null,
      0
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    await throwResponseError(response);
  }

  if (response.status === 204) {
    return null;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (parseError) {
    throw new ApiError("INVALID_RESPONSE", "响应格式不正确", null, response.status);
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiError("INVALID_RESPONSE", "响应格式不正确", null, response.status);
  }

  return payload.data ?? null;
}
