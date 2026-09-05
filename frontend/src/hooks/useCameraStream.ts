import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { streamApiClient } from '@/api/streamClient'
import { playlistUrl } from '@/api/stream'
import { getStreamApiErrorStatus, getStreamRetryAfterSeconds } from '@/api/streamClient'

export type StreamStep =
  | 'connecting'
  | 'playing'
  | 'stopped'
  | 'err404'
  | 'err500'
  | 'err502'
  | 'err-codec'
  | 'err-decode'
  | 'err-unknown'

export interface StreamLogEntry {
  at: string // mm:ss since this attempt started
  code: string // "503" | "200" | "GET" | ...
  msg: string
}

interface UseCameraStreamState {
  step: StreamStep
  /** Seconds elapsed since this connection attempt started (this poll cycle, or this play session). */
  elapsedSec: number
  /** Seconds it actually took to connect, once playing — frozen at that value while playing. */
  connectedInSec: number | null
  pollCount: number
  nextPollInSec: number
  log: StreamLogEntry[]
  /**
   * True while `step === 'playing'` but hls.js has run out of buffered
   * video and is waiting on the next segment — a real, expected state with
   * this backend's unusually long segments (8-30s+, this camera's actual
   * keyframe interval; see video-stream/docs/PRD.md Section 9), not a
   * freeze. Surfaced so the player can show "buffering" instead of a
   * frozen frame with zero explanation — the actual complaint this field
   * exists to fix.
   */
  buffering: boolean
}

const STREAM_BASE_URL = import.meta.env.VITE_STREAM_API_BASE_URL ?? 'http://localhost:8100'
const POLL_INTERVAL_MS = 1000 // tick every second for the live elapsed-time display

/**
 * Drives one camera's real connect -> playing -> stopped/error lifecycle
 * against video-stream's actual API — no mocked timers. Mirrors the
 * backend's real, documented contract (video-stream/docs/PRD.md Section 6):
 * poll GET /stream/{camera_id}/index.m3u8, treat 503 as "still starting"
 * and retry after the real Retry-After header, treat 200 as ready and hand
 * the URL to hls.js, and map 404/500/502 to the distinct error states the
 * design calls for.
 */
export function useCameraStream(cameraId: string | null, videoEl: HTMLVideoElement | null) {
  const [state, setState] = useState<UseCameraStreamState>({
    step: 'connecting',
    elapsedSec: 0,
    connectedInSec: null,
    pollCount: 0,
    nextPollInSec: 5,
    log: [],
    buffering: false,
  })

  const hlsRef = useRef<Hls | null>(null)
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number>(Date.now())
  const cancelledRef = useRef(false)
  const attemptRef = useRef(0) // bumped on every reconnect so stale async callbacks no-op
  const detachVideoListenersRef = useRef<(() => void) | null>(null)
  // Forward reference: start() is defined later in this hook (it depends
  // on poll/attachHlsAndPlay above it), but the error handler inside
  // attachHlsAndPlay needs to trigger a full restart when hls.js's own
  // recovery has already been exhausted. Set once, at the bottom of this
  // hook, right after start() is actually defined.
  const restartRef = useRef<(preserveLog?: boolean) => void>(() => {})
  const mediaResetAttemptsRef = useRef(0) // bumped per auto-restart; reset only on a genuine new cameraId/videoEl (see the effect near the bottom of this hook), not on every internal restart

  const clearTimers = useCallback(() => {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    pollTimeoutRef.current = null
    tickIntervalRef.current = null
  }, [])

  const teardownHls = useCallback(() => {
    detachVideoListenersRef.current?.()
    detachVideoListenersRef.current = null
    hlsRef.current?.destroy()
    hlsRef.current = null
  }, [])

  const mmss = (totalSec: number) => {
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const appendLog = useCallback((entry: StreamLogEntry) => {
    setState((prev) => ({ ...prev, log: [entry, ...prev.log].slice(0, 20) }))
  }, [])

  const attachHlsAndPlay = useCallback(
    (myAttempt: number) => {
      if (!videoEl || !cameraId) return
      const url = playlistUrl(STREAM_BASE_URL, cameraId)

      // Real root cause of the reconnect loop that followed a
      // mediaSourceRequiresReset: HTMLMediaElement.error is sticky — the
      // browser sets it and never clears it on its own, and there is no
      // public setter. Reusing the same <video> DOM node across a
      // teardown+reconnect (which this hook does deliberately, to avoid
      // re-mounting the element) meant every reconnect attempt hit the
      // exact same already-poisoned error state instantly: hls.js's own
      // SourceBuffer.appendBuffer threw "InvalidStateError ... The
      // HTMLMediaElement.error attribute is not null" before a single new
      // byte was ever decoded — confirmed directly from a real captured
      // log where the reconnect failed at 00:08, immediately, with that
      // exact message, not from a genuinely new decode error. The only
      // spec-defined way to clear `.error` is the browser's own media
      // element load algorithm, invoked by video.load() after removing
      // `src` — this must run before every attachMedia, not just after
      // detecting a poisoned state, since this path is also hit on a
      // manual Reconnect/Try again click.
      if (videoEl.error) {
        videoEl.removeAttribute('src')
        videoEl.load()
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          // The INITIAL manifest load is one thing; separately, hls.js
          // reloads the live playlist continuously in the background to
          // discover new segments, and that reload has its own retry
          // budget — levelLoadingMaxRetry, defaulting to only 4 attempts.
          // Real, observed cause of a stream dying mid-playback with
          // "networkError: levelLoadError" after several fine minutes:
          // this backend's RTSP gateway throughput genuinely varies run to
          // run (confirmed multiple times this session — see
          // video-stream/docs/PRD.md Section 9's measured 50-90s+ startup
          // range), so a real, ordinary network hiccup on a long-running
          // stream can burn through 4 retries and get treated as fatal —
          // even though the camera and backend are both still fine, as
          // this exact case showed (ffmpeg kept running, new segments kept
          // landing). A much larger retry budget with a capped backoff
          // gives real transient hiccups room to actually recover instead
          // of one bad network moment permanently ending a working stream.
          levelLoadingMaxRetry: 12,
          levelLoadingRetryDelay: 1000,
          levelLoadingMaxRetryTimeout: 30000,
          // hls.js's default (liveSyncDurationCount: 3, "stay 3 segments
          // behind the live edge") assumes short, roughly-uniform segments.
          // Real video-stream segments are anything but: a single playlist
          // pulled live from one camera showed durations of 2s, 10s, 30s,
          // and 61s side by side in the same 4-segment window — this
          // backend's -hls_time 2 is only a floor, and the actual length
          // is whatever the camera's keyframe interval happens to produce
          // at that moment (video-stream/docs/PRD.md Section 9). A FIXED
          // seconds value (what this used before) is fragile against that:
          // liveMaxLatencyDuration: 60 broke the moment a single real
          // segment ran 61s — hls.js judged itself outside the allowed
          // live-latency window and stalled trying to catch up to a live
          // edge that kept moving. Segment-COUNT config self-scales to
          // whatever length segments actually are instead of guessing a
          // number that the next irregular camera invalidates again.
          liveSyncDurationCount: 1,
          liveMaxLatencyDurationCount: 4,
          // This backend's per-camera GOP/segment timing is genuinely
          // erratic — one real playlist pulled live showed 12s, 1s, 6s,
          // 13s segments back-to-back for the same camera (see
          // video-stream/docs/PRD.md Section 9; -hls_time 2 is only a
          // floor, actual length follows whatever the camera's keyframe
          // interval does moment to moment). Widened to give that
          // irregularity room to be absorbed as a normal gap instead of
          // an error — this alone measurably delayed (from ~1min to
          // ~3.5min of real playback) but did not eliminate a repeated
          // mediaSourceRequiresReset failure, so it's necessary but not
          // sufficient on its own; see liveBackBufferLength below for the
          // fix that addresses the failure actually recurring over time.
          maxBufferHole: 1.0,
          appendErrorMaxRetry: 6,
          // The actual mechanism behind "plays fine for a few minutes,
          // then fails" (not immediately): hls.js's default
          // liveBackBufferLength is null, which falls through to
          // backBufferLength: Infinity — meaning for a LIVE stream, no
          // already-played segment is ever evicted from the browser's
          // SourceBuffer automatically. Every segment this camera has
          // produced since connecting stays resident in memory for the
          // entire session (some segments here ran 175KB+, on top of the
          // erratic timing above). hls.js's own append-error handler
          // checks for exactly this — QuotaExceededError — as the first
          // thing it does before falling through to the generic
          // BUFFER_APPEND_ERROR / MEDIA_SOURCE_REQUIRES_RESET path this
          // hook already had to add handling for. Explicitly bounding the
          // live back-buffer keeps memory bounded regardless of how long
          // a stream has been playing, instead of relying on unbounded
          // growth until a quota error reactively (and only sometimes
          // successfully) triggers eviction.
          liveBackBufferLength: 30,
        })
        hlsRef.current = hls
        hls.loadSource(url)
        hls.attachMedia(videoEl)

        // The video element's native waiting/playing events are the real,
        // ground-truth signal for "has the browser's decoder actually run
        // out of buffered data right now" — more reliable here than hls.js's
        // own BUFFER_STALLED_ERROR, which fires only once per stall period
        // and is normally non-fatal (hls.js auto-recovers once the next
        // segment lands). With this backend's 8-30s+ segments, running dry
        // between segments is expected, not a bug — this just makes that
        // real, normal wait visible instead of an unexplained frozen frame
        // (the actual complaint this is fixing).
        const onWaiting = () => {
          if (cancelledRef.current || attemptRef.current !== myAttempt) return
          setState((prev) => (prev.step === 'playing' ? { ...prev, buffering: true } : prev))
        }
        const onPlaying = () => {
          if (cancelledRef.current || attemptRef.current !== myAttempt) return
          setState((prev) => (prev.buffering ? { ...prev, buffering: false } : prev))
        }
        videoEl.addEventListener('waiting', onWaiting)
        videoEl.addEventListener('playing', onPlaying)
        detachVideoListenersRef.current = () => {
          videoEl.removeEventListener('waiting', onWaiting)
          videoEl.removeEventListener('playing', onPlaying)
        }

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelledRef.current || attemptRef.current !== myAttempt) return
          videoEl.play().catch(() => {
            /* autoplay can be blocked; the visible player still shows a play affordance via native controls if needed */
          })
        })
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (cancelledRef.current || attemptRef.current !== myAttempt) return
          const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
          if (!data.fatal) return

          // Surface the REAL underlying cause, not just hls.js's summary
          // label — data.details alone ("mediaSourceRequiresReset") only
          // says which recovery path hls.js took, not why. data.error is
          // the actual JS Error/DOMException (e.g. a real
          // QuotaExceededError has error.name === 'QuotaExceededError';
          // most others carry a real .message). videoEl.error is the
          // browser's own standard MediaError (code 1-4: ABORTED,
          // NETWORK, DECODE, SRC_NOT_SUPPORTED) if the media element
          // itself entered an error state — the authoritative signal MSE
          // exposes independent of whatever hls.js's own error name is.
          // Logged so a real recurrence gives an actual answer instead of
          // more guessing at hls.js config knobs.
          const errName = data.error?.name ?? typeof data.error
          const errMsg = data.error?.message ?? ''
          const mediaErrCode = videoEl.error?.code
          const mediaErrMsg = videoEl.error?.message ?? ''
          appendLog({
            at: mmss(elapsed),
            code: 'HLS',
            msg: `${data.type}: ${data.details} · error=${errName}${errMsg ? ':' + errMsg : ''}${mediaErrCode ? ` · mediaError=${mediaErrCode}:${mediaErrMsg}` : ''}`,
          })

          // bufferAddCodecError (and the related BUFFER_INCOMPATIBLE_CODECS_ERROR)
          // mean the browser's decoder rejected the codec in the segments —
          // real, observed cause: video-stream does -c:v copy with no
          // re-encoding (video-stream/docs/PRD.md Section 4, "no fancy"),
          // so a camera whose native feed is HEVC/H.265 passes straight
          // through untouched, and most Chromium browsers have no HEVC
          // decoder wired into MSE. This is not transient — retrying re-runs
          // the exact same incompatible bytes through the same decoder, so
          // unlike a network-ish hls.js fatal error, this gets its own
          // state instead of silently leaving the player stuck on "Playing
          // live" with a black frame forever (the bug being fixed here).
          if (data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR || data.details === Hls.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR) {
            teardownHls()
            setState((prev) => ({ ...prev, step: 'err-codec' }))
            return
          }

          // MEDIA_SOURCE_REQUIRES_RESET / BUFFER_APPEND_ERROR: real,
          // researched root cause (not this hook's own guess) — a
          // genuine PIPELINE_ERROR_DECODE from Chromium's own media
          // pipeline is a well-documented, Chrome-specific decoder
          // rejection of a particular camera's stream content (Chrome's
          // decoder is measurably stricter than Firefox/Safari's here —
          // see e.g. github.com/blakeblackshear/frigate discussion #20187,
          // an unrelated NVR project hitting the identical error with
          // RTSP cameras). It is NOT fixable by hls.js config, buffer
          // tuning, or reconnecting — confirmed the hard way this
          // session: buffer-hole tolerance, back-buffer bounds, and a
          // from-scratch reconnect (including clearing the sticky
          // HTMLMediaElement.error via video.load(), the one real defect
          // actually found and fixed along the way) all still hit the
          // exact same decode rejection on this camera's stream. A
          // bounded 2-attempt auto-reconnect stays — worth keeping for a
          // genuinely transient MediaSource hiccup on an otherwise-fine
          // camera — but once exhausted, this is reported as its own
          // distinct, honest state (err-decode) rather than folded into
          // the generic "unexpected error" bucket, since retrying via
          // "Try again" for THIS specific cause will not help.
          if (data.details === Hls.ErrorDetails.MEDIA_SOURCE_REQUIRES_RESET || data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR) {
            if (mediaResetAttemptsRef.current < 2) {
              mediaResetAttemptsRef.current += 1
              appendLog({ at: mmss(elapsed), code: 'HLS', msg: `reconnecting (attempt ${mediaResetAttemptsRef.current}/2) after media source reset` })
              restartRef.current(true)
              return
            }
            appendLog({ at: mmss(elapsed), code: 'HLS', msg: 'auto-reconnect exhausted (2 attempts) — browser decoder rejected this stream' })
            teardownHls()
            setState((prev) => ({ ...prev, step: 'err-decode' }))
            return
          }

          // Any other fatal hls.js error (network/media errors hls.js
          // couldn't itself recover from) — genuinely worth a real retry,
          // unlike a codec mismatch.
          teardownHls()
          setState((prev) => ({ ...prev, step: 'err-unknown' }))
        })
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari has native HLS — no hls.js needed.
        videoEl.src = url
        videoEl.play().catch(() => {})
      }
    },
    [videoEl, cameraId, appendLog, teardownHls],
  )

  const poll = useCallback(
    async (myAttempt: number) => {
      if (!cameraId || cancelledRef.current || attemptRef.current !== myAttempt) return

      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
      try {
        // A HEAD-less GET against the real playlist endpoint: 200 means
        // the first segment is written and ffmpeg is genuinely producing
        // real video, matching how this was verified live against a real
        // camera (video-stream/docs/PRD.md Section 9).
        await streamApiClient.get(playlistUrl('', cameraId), { baseURL: STREAM_BASE_URL })
        if (cancelledRef.current || attemptRef.current !== myAttempt) return

        appendLog({ at: mmss(elapsed), code: '200', msg: 'index.m3u8 served · first segment written' })
        setState((prev) => ({ ...prev, step: 'playing', connectedInSec: elapsed }))
        attachHlsAndPlay(myAttempt)
      } catch (err) {
        if (cancelledRef.current || attemptRef.current !== myAttempt) return
        const status = getStreamApiErrorStatus(err)

        if (status === 503) {
          const retryAfter = getStreamRetryAfterSeconds(err, 5)
          appendLog({ at: mmss(elapsed), code: '503', msg: `playlist not ready · Retry-After: ${retryAfter}` })
          setState((prev) => ({
            ...prev,
            step: 'connecting',
            pollCount: prev.pollCount + 1,
            nextPollInSec: retryAfter,
          }))
          pollTimeoutRef.current = setTimeout(() => poll(myAttempt), retryAfter * 1000)
          return
        }

        if (status === 404) {
          appendLog({ at: mmss(elapsed), code: '404', msg: 'no stream_path registered for this camera_id' })
          setState((prev) => ({ ...prev, step: 'err404' }))
          return
        }
        if (status === 500) {
          appendLog({ at: mmss(elapsed), code: '500', msg: 'ffmpeg failed to start · FFMPEG_NOT_FOUND' })
          setState((prev) => ({ ...prev, step: 'err500' }))
          return
        }
        if (status === 502) {
          appendLog({ at: mmss(elapsed), code: '502', msg: 'camera lookup query failed' })
          setState((prev) => ({ ...prev, step: 'err502' }))
          return
        }

        appendLog({ at: mmss(elapsed), code: String(status ?? 'ERR'), msg: 'unexpected error contacting the relay' })
        setState((prev) => ({ ...prev, step: 'err-unknown' }))
      }
    },
    [cameraId, appendLog, attachHlsAndPlay],
  )

  const start = useCallback((preserveLog = false) => {
    clearTimers()
    teardownHls()
    cancelledRef.current = false
    attemptRef.current += 1
    const myAttempt = attemptRef.current
    startedAtRef.current = Date.now()
    // Real bug this fixed: start() unconditionally wiped `log` to `[]`,
    // including when called internally by the auto-reconnect above (on
    // mediaSourceRequiresReset/bufferAppendError). That silently erased
    // the exact diagnostic entry that logic just appended — from the
    // outside, a reconnect attempt that failed again looked identical to
    // one that was never tried at all, undermining the whole point of
    // the error-detail logging added above. A genuine new connection
    // (a fresh cameraId, or the user clicking Reconnect/Try again) still
    // starts a clean log; an internal auto-reconnect preserves history so
    // the request log actually shows what happened across all attempts.
    setState((prev) => ({
      step: 'connecting',
      elapsedSec: 0,
      connectedInSec: null,
      pollCount: 0,
      nextPollInSec: 5,
      log: preserveLog ? prev.log : [],
      buffering: false,
    }))
    appendLog({ at: '00:00', code: 'GET', msg: `/stream/${cameraId?.slice(0, 8) ?? '…'}/index.m3u8` })

    tickIntervalRef.current = setInterval(() => {
      if (cancelledRef.current || attemptRef.current !== myAttempt) return
      setState((prev) =>
        prev.step === 'connecting'
          ? { ...prev, elapsedSec: Math.floor((Date.now() - startedAtRef.current) / 1000) }
          : prev,
      )
    }, POLL_INTERVAL_MS)

    poll(myAttempt)
  }, [clearTimers, teardownHls, poll, appendLog, cameraId])

  const stop = useCallback(() => {
    clearTimers()
    teardownHls()
    attemptRef.current += 1 // invalidate any in-flight poll
    setState((prev) => ({ ...prev, step: 'stopped' }))
  }, [clearTimers, teardownHls])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    clearTimers()
    teardownHls()
  }, [clearTimers, teardownHls])

  useEffect(() => {
    if (!cameraId) return
    mediaResetAttemptsRef.current = 0
    restartRef.current = start
    start()
    return () => {
      cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, videoEl])

  return { ...state, restart: start, stop, cancel }
}
