import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Video, Grid2x2, Search } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { SkeletonStack } from '@/components/ui/Skeleton'
import { useStreamCameras } from '@/hooks/useStreamCameras'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

// Pixel-matched to the reference (Sentinel.dc.html, at.stream): a filter
// input + count line, then a card grid of every streamable camera, each a
// placeholder "no preview available" tile (video-stream never exposes
// thumbnails — see video-stream/docs/PRD.md Section 4.5) plus name/id/tag.
export function LiveStreamListPage() {
  const navigate = useNavigate()
  usePageTitle(
    'Live Stream',
    <button
      onClick={() => navigate('/live-stream/grid')}
      className="flex h-[34px] items-center gap-2 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 text-[12.5px] font-medium hover:bg-[var(--bg-surface-sunken)]">
      <Grid2x2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      Open 4-up grid
    </button>,
  )
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 200)

  const camerasQuery = useStreamCameras()

  const filtered = useMemo(() => {
    const allCameras = camerasQuery.data?.cameras ?? []
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return allCameras
    return allCameras.filter((c) => c.name.toLowerCase().includes(q))
  }, [camerasQuery.data, debouncedQuery])

  const allCameras = camerasQuery.data?.cameras ?? []

  return (
    <div className="px-6 pb-14 pt-7">
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[22px] font-semibold tracking-tight">Live stream</div>
          <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[var(--text-secondary)]">
            Streams start on demand, one camera at a time. First frame typically takes 50 to 90 seconds — the camera's
            keyframe interval, not a fault.
          </p>
        </div>
      </div>

      <div className="mb-3 mt-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-[15px] w-[15px] text-[var(--text-secondary)]" strokeWidth={1.9} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter streamable cameras…"
            className="h-8 w-[240px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-surface)] pl-8 pr-3 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          />
        </div>
        <span className="text-[12.5px] text-[var(--text-secondary)]">
          {camerasQuery.isLoading ? 'Loading…' : `${filtered.length} of ${allCameras.length} streamable cameras`}
        </span>
      </div>

      {camerasQuery.isLoading ? (
        <SkeletonStack count={8} rowClassName="h-[180px]" />
      ) : camerasQuery.isError ? (
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center text-[13px] text-[var(--text-secondary)]">
          Couldn't reach the streaming relay. It may be offline — try again shortly.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center text-[13px] text-[var(--text-secondary)]">
          {allCameras.length === 0 ? 'No cameras have a registered stream path yet.' : 'No cameras match this filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] gap-3">
          {filtered.map((c) => (
            <div
              key={c.camera_id}
              onClick={() => navigate(`/live-stream/${c.camera_id}`)}
              className="cursor-pointer overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-raised)]">
              <div className="flex h-[130px] flex-col items-center justify-center gap-1.5 border-b border-[var(--border-default)] bg-[var(--bg-surface-sunken)] text-[var(--text-secondary)]">
                <Video className="h-[22px] w-[22px]" strokeWidth={1.5} />
                <span className="text-[11.5px]">No preview available</span>
              </div>
              <div className="px-[15px] py-[13px]">
                <div className="truncate text-[13.5px] font-semibold">{c.name}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">{c.camera_id}</span>
                  <span className="shrink-0 rounded-full bg-[var(--bg-surface-sunken)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--text-secondary)]">
                    Idle
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[15px] py-3.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--text-secondary)]" />
        <div className="text-[12.5px] text-[var(--text-secondary)]">
          Only cameras with a registered stream path appear here. A camera missing from this list isn't broken — live
          streaming simply isn't set up for it. No thumbnails, quality readings, or audio are available from the relay.
        </div>
      </div>
    </div>
  )
}
