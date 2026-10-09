export type Sound = "step" | "complete" | "daily" | "reward" | "focus";
let context: AudioContext | undefined;
export function primeAudio() {
  if (typeof window === "undefined") return;
  try { context ??= new AudioContext(); if (context.state === "suspended") void context.resume(); } catch { /* Audio support is optional. */ }
}
export function playSound(kind: Sound) {
  if (localStorage.getItem("pawnsteps-muted") === "true") return;
  primeAudio();
  if (!context) return;
  const ctx = context;
  const melodies: Record<Sound, [number, number, number][]> = {
    focus: [[880, 0, .35], [659.25, .4, .35], [880, .8, .6], [1046.5, 1.5, .7]],
    step: [[660, 0, .09]],
    daily: [[523.25, 0, .14], [783.99, .16, .22]],
    complete: [[523.25, 0, .15], [659.25, .12, .15], [783.99, .24, .15], [1046.5, .36, .4]],
    reward: [[392, 0, .28], [523.25, .1, .3], [659.25, .2, .35], [783.99, .3, .4], [1046.5, .45, .65], [1318.51, .55, .65], [1567.98, .65, .6]],
  };
  for (const [frequency, offset, duration] of melodies[kind]) {
    const oscillator = ctx.createOscillator(); const gain = ctx.createGain();
    const start = ctx.currentTime + offset;
    oscillator.type = kind === "daily" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(kind === "reward" ? .055 : .09, start + .015);
    gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(start); oscillator.stop(start + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
