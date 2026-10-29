/**
 * Terminal 相关接口与 WebSocket 地址构造。
 */

import { TERMINAL_API_PATH } from "../config.js";
import { requestJson } from "./client.js";

/**
 * 返回 Terminal 集合接口的完整地址。
 *
 * @returns {URL} 集合地址（以 / 结尾）。
 */
export function buildCollectionUrl() {
  return new URL(TERMINAL_API_PATH, document.baseURI);
}

/**
 * 返回单个 Terminal 的接口地址。
 *
 * @param {string} terminalId Terminal ID。
 * @returns {URL} 接口地址。
 */
function buildTerminalUrl(terminalId) {
  return new URL(encodeURIComponent(terminalId), buildCollectionUrl());
}

/**
 * 创建一个新的 Terminal。
 *
 * 按照任务要求不携带其他创建参数，只根据当前终端窗口大小指定
 * PTY 的初始尺寸（后端格式为 `[rows, columns]`）。
 *
 * @param {{columns: number, rows: number}} dimensions 终端窗口的字符尺寸。
 * @returns {Promise<{id: string, width: number, height: number, expiredAt: number}>} 新 Terminal 的信息。
 */
export function createTerminal(dimensions) {
  const body = {};
  if (dimensions && dimensions.columns > 0 && dimensions.rows > 0) {
    body.dimensions = [dimensions.rows, dimensions.columns];
  }
  return requestJson("POST", buildCollectionUrl(), body);
}

/**
 * 查询一个 Terminal 的信息。
 *
 * @param {string} terminalId Terminal ID。
 * @returns {Promise<{id: string, width: number, height: number, expiredAt: number}>} Terminal 信息。
 */
export function getTerminal(terminalId) {
  return requestJson("GET", buildTerminalUrl(terminalId));
}

/**
 * 删除一个 Terminal。
 *
 * @param {string} terminalId Terminal ID。
 * @returns {Promise<null>} 删除完成时返回 null。
 */
export function deleteTerminal(terminalId) {
  return requestJson("DELETE", buildTerminalUrl(terminalId));
}

/**
 * 构造与 Terminal 通信的 WebSocket 地址。
 *
 * 根据页面协议自动选择 ws:// 或 wss://。
 *
 * @param {string} terminalId Terminal ID。
 * @returns {string} WebSocket URL。
 */
export function buildTerminalWebSocketUrl(terminalId) {
  const url = new URL(encodeURIComponent(terminalId), buildCollectionUrl());
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
