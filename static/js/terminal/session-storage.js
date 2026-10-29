/**
 * Terminal 会话的本地存储。
 *
 * 保存 Terminal ID 与连接状态，使用 localStorage 让页面刷新或重新打开
 * 后能够恢复输入框内容，并在上次处于连接状态时自动重连。
 */

/** localStorage 中保存会话状态的键名。 */
const SESSION_STORAGE_KEY = "web-terminal.session";

/** 默认的空会话状态。 */
const EMPTY_SESSION = Object.freeze({
  terminalId: "",
  connected: false,
});

/**
 * 从 localStorage 读取会话状态。
 *
 * 数据缺失或格式不正确时返回空状态；localStorage 不可用时也不会抛错。
 *
 * @returns {{terminalId: string, connected: boolean}} 会话状态。
 */
export function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return { ...EMPTY_SESSION };
    }
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== "object") {
      return { ...EMPTY_SESSION };
    }
    return {
      terminalId:
        typeof stored.terminalId === "string" ? stored.terminalId : "",
      connected: stored.connected === true,
    };
  } catch (error) {
    return { ...EMPTY_SESSION };
  }
}

/**
 * 把会话状态写入 localStorage。
 *
 * 在隐私模式或存储配额已满等情况下静默失败，不影响终端使用。
 *
 * @param {{terminalId: string, connected: boolean}} session 会话状态。
 * @returns {boolean} 是否成功写入。
 */
export function saveStoredSession(session) {
  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        terminalId:
          typeof session.terminalId === "string" ? session.terminalId : "",
        connected: session.connected === true,
      })
    );
    return true;
  } catch (error) {
    return false;
  }
}
