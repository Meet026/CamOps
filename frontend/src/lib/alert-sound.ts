// A short, generated alert tone (two-beep) for the wanted-list match toast —
// no audio file to host; built with the Web Audio API so it works
// everywhere without a network request. Browsers require a user gesture
// before audio can play; this is always called from the "Check plate"
// button's own click handler, which satisfies that.
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

function beep(ctx: AudioContext, startTime: number, frequency: number, durationSec: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = frequency;

  // Quick fade in/out avoids an audible click at the start/end of the tone.
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.25, startTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, startTime + durationSec);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + durationSec);
}

export function playWantedMatchAlert(): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    // Two urgent beeps, alternating high/low — reads as an alert tone
    // rather than a generic notification chime.
    beep(ctx, now, 880, 0.14);
    beep(ctx, now + 0.18, 660, 0.14);
  } catch {
    // Audio is a nice-to-have here — never let a sound failure (blocked
    // autoplay policy, no audio hardware, etc.) break the actual feature.
  }
}
