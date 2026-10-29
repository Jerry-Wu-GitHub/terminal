/**
 * 前端入口。
 *
 * 创建屏幕模型、渲染器、会话控制器与输入桥，并完成初始化。
 */

import {
  DEFAULT_TERMINAL_COLUMNS,
  DEFAULT_TERMINAL_ROWS,
} from "./config.js";
import { unlockAudio } from "./terminal/bell.js";
import { TerminalController } from "./terminal/controller.js";
import { TerminalRenderer } from "./terminal/renderer.js";
import { TerminalScreen } from "./terminal/screen.js";
import { InputBridge } from "./ui/input-bridge.js";
import { showError, showInfo, showSuccess } from "./ui/toast.js";

/**
 * 收集页面元素。
 *
 * @returns {Object} 元素集合。
 */
function collectElements() {
  return {
    scrollContainer: document.getElementById("terminal-scroll"),
    paper: document.getElementById("terminal-paper"),
    scrollbackContainer: document.getElementById("scrollback-rows"),
    screenContainer: document.getElementById("screen-rows"),
    cursorElement: document.getElementById("terminal-cursor"),
  };
}

/** 应用启动入口。 */
function bootstrap() {
  const elements = collectElements();
  const screen = new TerminalScreen(
    DEFAULT_TERMINAL_COLUMNS,
    DEFAULT_TERMINAL_ROWS
  );
  screen.cursorVisible = false;

  const renderer = new TerminalRenderer(elements);
  renderer.initialize();
  renderer.sync(screen);

  const controller = new TerminalController({
    screen,
    renderer,
    showInfo,
    showError,
    showSuccess,
  });

  const inputBridge = new InputBridge({
    paper: elements.paper,
    screen,
    controller,
    showInfo,
    showError,
    showSuccess,
  });
  inputBridge.initialize();

  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  window.addEventListener("pagehide", () => controller.handlePageHide());
  window.addEventListener("pageshow", () => controller.handlePageShow());

  controller.restoreSession();
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    bootstrap();
  } catch (error) {
    console.error("终端初始化失败：", error);
    showError(error);
  }
});
