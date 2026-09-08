/**
 * Alert tone for watchlist hits, synthesized with the Web Audio API.
 *
 * Deliberately not an audio file: this needs no asset to load, no new
 * dependency, and cannot fail with a 404 mid-demo.
 *
 * Browsers block audio until the user has interacted with the page. In
 * this flow the alert always follows a click (submitting an
 * investigation), so the AudioContext is created on that gesture and is
 * allowed to play. Every call is still wrapped defensively — a browser
 * refusing to play sound must never break the page.
 */

let audioContext: AudioContext | null = null

function getContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioContext = new Ctor()
    }
    // Safari and Chrome start the context suspended until a gesture.
    if (audioContext.state === 'suspended') void audioContext.resume()
    return audioContext
  } catch {
    return null
  }
}

/** One tone: a short beep at `frequency`, starting `startAt` seconds from now. */
function beep(ctx: AudioContext, frequency: number, startAt: number, duration: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'square'
  osc.frequency.value = frequency

  const t0 = ctx.currentTime + startAt
  // Ramp the envelope rather than switching gain instantly — an abrupt
  // start or stop produces an audible click.
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.14, t0 + 0.01)
  gain.gain.setValueAtTime(0.14, t0 + duration - 0.03)
  gain.gain.linearRampToValueAtTime(0, t0 + duration)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration)
}

/**
 * Two-tone rising alert, repeated twice — reads as urgent without being
 * the kind of sound that makes a room jump.
 */
export function playAlertSound() {
  const ctx = getContext()
  if (!ctx) return
  try {
    beep(ctx, 880, 0, 0.16)
    beep(ctx, 1180, 0.18, 0.16)
    beep(ctx, 880, 0.44, 0.16)
    beep(ctx, 1180, 0.62, 0.22)
  } catch {
    // Audio is a nice-to-have; never let it break the investigation flow.
  }
}
