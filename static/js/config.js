/**
 * 前端全局常量。
 *
 * 集中放置接口路径、轮询周期、终端尺寸与默认颜色等配置，避免在
 * 各个模块里散落魔法数字。
 */

/** Terminal REST 接口路径（相对于页面所在目录）。 */
export const TERMINAL_API_PATH = "api/v1/terminals/";

/** 已连接时轮询 Terminal 信息的时间间隔（毫秒）。 */
export const POLL_INTERVAL_MILLISECONDS = 10000;

/** 单次 HTTP 请求的超时时间（毫秒）。 */
export const REQUEST_TIMEOUT_MILLISECONDS = 10000;

/** 终端滚动回看历史的最大行数。 */
export const MAX_SCROLLBACK_LINES = 5000;

/** 终端在建立连接前的默认列数。 */
export const DEFAULT_TERMINAL_COLUMNS = 80;

/** 终端在建立连接前的默认行数。 */
export const DEFAULT_TERMINAL_ROWS = 24;

/** 默认前景色，与 CSS 中的 --terminal-fg 保持一致。 */
export const DEFAULT_FOREGROUND = "#dce6dd";

/** 默认背景色，与 CSS 中的 --terminal-bg 保持一致。 */
export const DEFAULT_BACKGROUND = "#060806";

/** 普通 ANSI 颜色（SGR 30-37）。 */
export const ANSI_NORMAL_COLORS = [
  "#1c221d",
  "#ff5f57",
  "#33d17a",
  "#e5c07b",
  "#61afef",
  "#c678dd",
  "#56b6c2",
  "#cdd6d0",
];

/** 高亮 ANSI 颜色（SGR 90-97）。 */
export const ANSI_BRIGHT_COLORS = [
  "#5f6b62",
  "#ff7b72",
  "#69e39a",
  "#f0d58c",
  "#8cc8ff",
  "#dda0ff",
  "#7fd4e0",
  "#ffffff",
];
