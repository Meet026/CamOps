import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Video } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useStreamCameras } from '@/hooks/useStreamCameras'
import { useCameraStream } from '@/hooks/useCameraStream'
import { cn } from '@/lib/utils'
import type { StreamCamera } from '@/types/streamApi'

const mmss = (totalSec: number) => {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const STATE_LABEL: Record<string, string> = {
  connecting: 'connecting',
  playing: 'live',
  stopped: 'stopped',
  err404: '404',
  err500: '500',
  err502: '502',
  'err-codec': 'unsupported format',
  'err-decode': 'decoder rejected',
  'err-unknown': 'error',
}
const STATE_COLOR: Record<string, string> = {
  connecting: 'var(--color-brand)',
  playing: 'var(--color-status-online)',
  stopped: 'var(--text-secondary)',
  err404: 'var(--color-status-unknown)',
  err500: 'var(--color-status-offline)',
  err502: 'var(--color-status-offline)',
  'err-codec': 'var(--color-status-unknown)',
  'err-decode': 'var(--color-status-unknown)',
  'err-unknown': 'var(--color-status-offline)',
}

/** One tile in the 4-up grid — each camera independently connects on its own real timeline (video-stream/docs/PRD.md Section 4.4: no bulk-start optimization, staggered per-tile loading is the expected result, not a fault). */
function StreamTile({ camera, resetKey }: { camera: StreamCamera; resetKey: number }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const stream = useCameraStream(camera.camera_id, videoEl)

  const isPlaying = stream.step === 'playing'
  const isConnecting = stream.step === 'connecting'
  const isFailed = stream.step.startsWith('err') || stream.step === 'stopped'

  // resetKey changing forces this tile to remount (see key= on the parent
  // map below) — the simplest correct way to make "Restart all" actually
  // restart every tile's real connection, not just its own local retry.
  void resetKey

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="relative aspect-video bg-[#07080A]">
        <video ref={(el) => { videoRef.current = el; setVideoEl(el) }} className={cn('h-full w-full', !isPlaying && 'hidden')} muted playsInline />

        {isPlaying && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-[rgba(239,68,68,0.92)] px-2.25 py-1 text-[10.5px] font-bold tracking-wide text-white">
            <span className="h-1.25 w-1.25 animate-stream-pulse rounded-full bg-white" />
            LIVE
          </span>
        )}

        {isPlaying && stream.buffering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
          </div>
        )}

        {isConnecting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
            <div className="font-mono text-xl font-semibold tabular-nums text-[#F4F5F7]">{mmss(stream.elapsedSec)}</div>
            <div className="mt-1.25 text-xs text-[#8B93A1]">Connecting · up to a minute</div>
            <div className="mt-3.5 h-[3px] w-[70%] overflow-hidden rounded-full bg-white/[0.09]">
              <div className="h-full w-[34%] animate-stream-marquee rounded-full bg-[var(--color-brand)]" />
            </div>
          </div>
        )}

        {isFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
            <span
              className="mb-2.25 inline-flex h-8 w-8 items-center justify-center rounded-full"
              style={{
                background: ['err404', 'err-codec', 'err-decode'].includes(stream.step) ? 'rgba(245,158,11,0.16)' : 'rgba(239,68,68,0.16)',
                color: ['err404', 'err-codec', 'err-decode'].includes(stream.step) ? '#F59E0B' : '#EF4444',
              }}>
              <AlertCircle className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div className="text-[12.5px] font-semibold text-[#F4F5F7]">
              {stream.step === 'stopped'
                ? 'Stream stopped'
                : stream.step === 'err-codec'
                  ? "Camera's format isn't supported"
                  : stream.step === 'err-decode'
                    ? "Browser decoder rejected this stream"
                    : "Couldn't start this stream"}
            </div>
            {stream.step !== 'err-codec' && stream.step !== 'err-decode' && (
              <button
                onClick={() => stream.restart()}
                className="mt-3 rounded-[8px] border border-white/[0.16] bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-[#F4F5F7] hover:bg-white/[0.09]">
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 px-3.5 py-2.75">
        <span className="h-1.75 w-1.75 shrink-0 rounded-full" style={{ background: STATE_COLOR[stream.step] }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{camera.name}</div>
        </div>
        <span className="shrink-0 font-mono text-[11.5px] text-[var(--text-secondary)]">{STATE_LABEL[stream.step]}</span>
      </div>
    </div>
  )
}

// Pixel-matched to the reference (Sentinel.dc.html, at.sgrid). Unlike the
// mockup — which fabricates 4 fixed demo tiles with mock offsets — this
// takes the first 4 real streamable cameras from GET /cameras and connects
// each independently via useCameraStream.
export function LiveStreamGridPage() {
  const navigate = useNavigate()
  const [resetKey, setResetKey] = useState(0)
  usePageTitle(
    '4-up grid',
    <div className="flex gap-2">
      <button
        onClick={() => setResetKey((k) => k + 1)}
        className="flex h-8 items-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 text-[12.5px] font-medium hover:bg-[var(--bg-surface-sunken)]">
        Restart all
      </button>
      <button
        onClick={() => navigate('/live-stream')}
        className="flex h-8 items-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 text-[12.5px] font-medium hover:bg-[var(--bg-surface-sunken)]">
        Single camera
      </button>
    </div>,
  )
  const camerasQuery = useStreamCameras()
  const tiles = (camerasQuery.data?.cameras ?? []).slice(0, 4)

  return (
    <div className="mx-auto max-w-[1320px] px-6 pb-12 pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <div className="text-xl font-semibold tracking-tight">4-up grid</div>
          <p className="mt-1.25 max-w-[64ch] text-[13px] text-[var(--text-secondary)]">
            Each tile connects on its own. Some tiles playing while others are still connecting is the expected result,
            not a fault.
          </p>
        </div>
      </div>

      {camerasQuery.isLoading ? null : camerasQuery.isError ? (
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center text-[13px] text-[var(--text-secondary)]">
          <Video className="mx-auto mb-2 h-6 w-6 text-[var(--text-secondary)]" strokeWidth={1.5} />
          Couldn't reach the streaming relay. It may be offline — try again shortly.
        </div>
      ) : tiles.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center text-[13px] text-[var(--text-secondary)]">
          <Video className="mx-auto mb-2 h-6 w-6 text-[var(--text-secondary)]" strokeWidth={1.5} />
          No cameras have a registered stream path yet.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
          {tiles.map((c) => (
            <StreamTile key={`${c.camera_id}-${resetKey}`} camera={c} resetKey={resetKey} />
          ))}
        </div>
      )}
    </div>
  )
}
