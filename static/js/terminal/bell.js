/**
 * 终端提示音（BEL，0x07）。
 *
 * 使用 Web Audio 合成短促的提示音。AudioContext 在用户首次交互后
 * 解锁，避免浏览器的自动播放限制。
 */

let audioContext = null;

/**
 * 获取或创建 AudioContext。
 *
 * @returns {AudioContext|null} 音频上下文。
 */
function getAudioContext() {
  const AudioContextConstructor =
    window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }
  return audioContext;
}

/** 在用户手势中解锁音频上下文。 */
export function unlockAudio() {
  const context = getAudioContext();
  if (context && context.state === "suspended") {
    context.resume().catch(() => {});
  }
}

/** 播放一声短促的终端提示音。 */
export function playBell() {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, now);
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.12);
}
