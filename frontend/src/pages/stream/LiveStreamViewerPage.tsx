import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Square, Video } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useStreamCameras } from '@/hooks/useStreamCameras'
import { useCameraStream, type StreamStep } from '@/hooks/useCameraStream'
import { cn } from '@/lib/utils'

const mmss = (totalSec: number) => {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const ERROR_META: Record<string, { title: string; body: string; code: string; retryable: boolean }> = {
  err404: {
    title: "This camera doesn't have live streaming set up",
    body: 'No stream path is registered for it. Another camera from the list will work.',
    code: '404 · no stream_path',
    retryable: false,
  },
  err500: {
    title: "Couldn't start this stream",
    body: 'The relay failed to launch the conversion process. Trying again often works; otherwise pick another camera.',
    code: '500 · FFMPEG_NOT_FOUND',
    retryable: true,
  },
  err502: {
    title: 'Camera system temporarily unavailable',
    body: "The camera registry couldn't be reached. Try again shortly.",
    code: '502 · camera lookup failed',
    retryable: true,
  },
  'err-codec': {
    title: "This camera's video format isn't supported by this browser",
    body: "The relay doesn't re-encode video — it passes the camera's feed through as-is (video-stream/docs/PRD.md, \"nothing fancy\"). This camera streams HEVC/H.265, which most browsers can't decode. Trying again won't change the camera's format; pick another camera instead.",
    code: 'bufferAddCodecError · likely HEVC/H.265',
    retryable: false,
  },
  'err-decode': {
    title: "This browser's video decoder rejected this camera's stream",
    body: "This is a real, known limitation of Chrome/Chromium's media decoder with certain cameras' stream content (independently documented by other camera-streaming projects hitting the identical error) — not a bug in the relay, and not something a retry can fix. The relay passes video through unchanged (video-stream/docs/PRD.md, \"nothing fancy\"); most cameras play fine here. Try Firefox for this specific camera, or pick another camera.",
    code: 'PIPELINE_ERROR_DECODE',
    retryable: false,
  },
  'err-unknown': {
    title: 'Something went wrong contacting the relay',
    body: 'An unexpected error occurred. Try again, or pick another camera.',
    code: 'unexpected error',
    retryable: true,
  },
}

const STATE_LABEL: Record<StreamStep, { label: string; color: string }> = {
  connecting: { label: 'Connecting · polling every 5s', color: 'var(--color-brand)' },
  playing: { label: 'Playing live', color: 'var(--color-status-online)' },
  stopped: { label: 'Stopped · relay released the camera', color: 'var(--text-secondary)' },
  err404: { label: 'No stream configured', color: 'var(--color-status-unknown)' },
  err500: { label: 'Failed to start', color: 'var(--color-status-offline)' },
  err502: { label: 'Registry unavailable', color: 'var(--color-status-offline)' },
  'err-codec': { label: 'Unsupported video format', color: 'var(--color-status-offline)' },
  'err-decode': { label: 'Decoder rejected stream', color: 'var(--color-status-offline)' },
  'err-unknown': { label: 'Unexpected error', color: 'var(--color-status-offline)' },
}

// Pixel-matched to the reference (Sentinel.dc.html, at.sview): a 16:9 player
// surface that shows exactly one of Connecting / Playing / Stopped / Error
// at a time, a state strip + request log below it. Unlike the mockup — which
// simulates these four states with a mock timer and a "Preview outcome"
// switcher for demo purposes — this drives every state from real
// video-stream API responses via useCameraStream (see that hook for the
// real 503/Retry-After polling contract, verified live in
// video-stream/docs/PRD.md Section 9).
export function LiveStreamViewerPage() {
  const { cameraId = '' } = useParams<{ cameraId: string }>()
  const navigate = useNavigate()
  usePageTitle('Live Stream / Viewer')
  const [logOpen, setLogOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  const camerasQuery = useStreamCameras()
  const camera = camerasQuery.data?.cameras.find((c) => c.camera_id === cameraId)

  const stream = useCameraStream(cameraId || null, videoEl)

  const isConnecting = stream.step === 'connecting'
  const isPlaying = stream.step === 'playing'
  const isStopped = stream.step === 'stopped'
  const isError = stream.step.startsWith('err')
  const errMeta = ERROR_META[stream.step] ?? ERROR_META['err-unknown']
  const stateMeta = STATE_LABEL[stream.step]

  const pollLine = isConnecting
    ? `GET index.m3u8 → 503 · ${stream.pollCount} ${stream.pollCount === 1 ? 'retry' : 'retries'} · next in ${stream.nextPollInSec}s`
    : isPlaying
      ? 'GET index.m3u8 → 200 · segments rotating, 4-deep window'
      : errMeta.code

  return (
    <div className="mx-auto max-w-[1180px] px-6 pb-10 pt-5">
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-[1_1_260px]">
          <div className="text-[17px] font-semibold tracking-tight">{camera?.name ?? '—'}</div>
          <div className="mt-0.5 font-mono text-xs text-[var(--text-secondary)]">{cameraId}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <div className="relative aspect-video bg-[#07080A]">
          <video ref={(el) => { videoRef.current = el; setVideoEl(el) }} className={cn('h-full w-full', !isPlaying && 'hidden')} muted playsInline />

          {isConnecting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <div className="font-mono text-[34px] font-semibold tracking-tight tabular-nums text-[#F4F5F7]">
                {mmss(stream.elapsedSec)}
              </div>
              <div className="mt-2.5 text-[15px] font-semibold text-[#F4F5F7]">Connecting to camera</div>
              <div className="mt-1 max-w-[44ch] text-[13px] text-[#8B93A1]">
                This can take up to a minute. The camera only cuts a segment on a keyframe, so the first frame is slow to
                arrive.
              </div>
              <div className="mt-5.5 h-[3px] w-[min(340px,72%)] overflow-hidden rounded-full bg-white/[0.09]">
                <div className="h-full w-[34%] animate-stream-marquee rounded-full bg-[var(--color-brand)]" />
              </div>
              <button
                onClick={() => navigate('/live-stream')}
                className="mt-6 rounded-[8px] border border-white/[0.16] bg-white/[0.05] px-4.5 py-2.5 text-[13px] font-medium text-[#F4F5F7] hover:bg-white/[0.09]">
                Cancel and pick another camera
              </button>
            </div>
          )}

          {isPlaying && (
            <>
              <div className="absolute left-3.5 top-3.5 flex items-center gap-3">
                <span className="flex items-center gap-1.5 rounded-full bg-[rgba(239,68,68,0.92)] px-2.5 py-1 text-[11.5px] font-bold tracking-wide text-white">
                  <span className="h-1.5 w-1.5 animate-stream-pulse rounded-full bg-white" />
                  LIVE
                </span>
                <span className="font-mono text-[11.5px] text-[#8B93A1]">no audio</span>
              </div>

              {stream.buffering && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                  <span className="text-xs text-white/90">
                    Buffering — waiting on the next segment. This camera's segments run long; a pause here is normal.
                  </span>
                </div>
              )}

              <div
                className="absolute inset-x-0 bottom-0 flex items-center gap-3.5 px-4 py-3"
                style={{ background: 'linear-gradient(0deg, rgba(0,0,0,.72), rgba(0,0,0,0))' }}>
                <button
                  onClick={() => stream.stop()}
                  className="flex items-center gap-2 rounded-[8px] border border-white/[0.16] bg-white/[0.06] px-3.5 py-[7px] text-[12.5px] font-medium text-[#F4F5F7] hover:bg-white/[0.1]">
                  <Square className="h-3 w-3" fill="currentColor" />
                  Stop
                </button>
                <span className="flex-1 text-xs text-[#8B93A1]">Live only — no rewind or seeking</span>
                <span className="font-mono text-[11.5px] text-[#8B93A1]">
                  connected in {stream.connectedInSec !== null ? mmss(stream.connectedInSec) : '—'}
                </span>
              </div>
            </>
          )}

          {isStopped && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <span className="mb-3.5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-[#8B93A1]">
                <Video className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <div className="text-[15px] font-semibold text-[#F4F5F7]">Stream stopped</div>
              <div className="mt-1 max-w-[44ch] text-[13px] text-[#8B93A1]">
                You stopped watching. The relay itself keeps running server-side for up to 90 more seconds in case you
                come back — reconnecting right away may be instant; waiting longer means going through the connect
                time again.
              </div>
              <button
                onClick={() => stream.restart()}
                className="mt-5 rounded-[8px] border border-transparent bg-[var(--color-brand)] px-4.5 py-2.5 text-[13px] font-semibold text-white hover:brightness-110">
                Reconnect
              </button>
            </div>
          )}

          {isError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <span
                className="mb-3.5 inline-flex h-10 w-10 items-center justify-center rounded-full"
                style={{
                  background: ['err404', 'err-codec', 'err-decode'].includes(stream.step) ? 'rgba(245,158,11,0.16)' : 'rgba(239,68,68,0.16)',
                  color: ['err404', 'err-codec', 'err-decode'].includes(stream.step) ? '#F59E0B' : '#EF4444',
                }}>
                <AlertCircle className="h-[19px] w-[19px]" strokeWidth={1.9} />
              </span>
              <div className="max-w-[40ch] text-[15px] font-semibold text-[#F4F5F7]">{errMeta.title}</div>
              <div className="mt-1.5 max-w-[46ch] text-[13px] text-[#8B93A1]">{errMeta.body}</div>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {errMeta.retryable && (
                  <button
                    onClick={() => stream.restart()}
                    className="rounded-[8px] border border-transparent bg-[var(--color-brand)] px-4.5 py-2.5 text-[13px] font-semibold text-white hover:brightness-110">
                    Try again
                  </button>
                )}
                <button
                  onClick={() => navigate('/live-stream')}
                  className="rounded-[8px] border border-white/[0.16] bg-white/[0.05] px-4.5 py-2.5 text-[13px] font-medium text-[#F4F5F7] hover:bg-white/[0.09]">
                  Pick another camera
                </button>
              </div>
              <div className="mt-4.5 font-mono text-[11.5px] text-[#5A6270]">{errMeta.code}</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border-default)] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-1.75 w-1.75 rounded-full" style={{ background: stateMeta.color }} />
            <span className="text-[12.5px] font-medium">{stateMeta.label}</span>
          </div>
          <span className="min-w-[200px] flex-1 font-mono text-[11.5px] text-[var(--text-secondary)]">{pollLine}</span>
          <button
            onClick={() => setLogOpen((v) => !v)}
            className="shrink-0 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface-sunken)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--bg-surface-raised)]">
            {logOpen ? 'Hide request log' : 'Request log'}
          </button>
        </div>

        {logOpen && (
          <div className="max-h-[190px] overflow-auto border-t border-[var(--border-default)] bg-[var(--bg-surface-sunken)] px-4 py-3">
            {stream.log.map((l, i) => (
              <div key={i} className="flex gap-3 py-0.75 font-mono text-[11.5px]">
                <span className="w-[52px] shrink-0 text-[var(--text-secondary)]">{l.at}</span>
                <span
                  className="w-[34px] shrink-0 font-semibold"
                  style={{ color: l.code === '200' ? 'var(--color-status-online)' : ['404', '500', '502'].includes(l.code) ? 'var(--color-status-offline)' : l.code === '503' ? 'var(--color-status-unknown)' : 'var(--text-secondary)' }}>
                  {l.code}
                </span>
                <span className="flex-1 text-[var(--text-secondary)]">{l.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
