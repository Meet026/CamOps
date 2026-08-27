import { useMemo, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useMapViewportQuery } from '@/hooks/useMapViewportQuery'
import { ViewportTracker } from './ViewportTracker'
import { CameraPinMarker } from './CameraPinMarker'
import { GapOverlay } from './GapOverlay'
import { HeatmapLayer } from './HeatmapLayer'
import { BetaBadge } from '@/components/ui/StatusPill'
import { cn } from '@/lib/utils'
import * as gisApi from '@/api/gis'

const GUJARAT_CENTER: [number, number] = [22.5, 71.5]

const STATUS_LEGEND = [
  { statusKey: 'online', label: 'Online', color: 'var(--color-status-online)' },
  { statusKey: 'offline', label: 'Offline', color: 'var(--color-status-offline)' },
  { statusKey: 'unknown', label: 'Unknown', color: 'var(--color-status-unknown)' },
] as const

const SCORE_LEGEND = [
  { statusKey: 'easy', label: 'Easy', color: 'var(--color-status-online)' },
  { statusKey: 'medium', label: 'Medium', color: 'var(--color-status-unknown)' },
  { statusKey: 'hard', label: 'Hard', color: 'var(--color-status-offline)' },
  { statusKey: 'needs_verification', label: 'Needs verification', color: 'var(--color-status-ai)' },
] as const

// Pixel-matched to the reference (Sentinel.dc.html): a "Panel" toggle
// (Floating over the map / Docked in a left sidebar), a real legend with
// live counts computed from the actual pins in view, and a "N cameras in
// view" counter — none of which existed in the previous build.
export function GisMapPage() {
  usePageTitle('Map')
  const { bounds, onBoundsChange } = useMapViewportQuery()

  const [colorMode, setColorMode] = useState<'status' | 'score'>('status')
  const [showGaps, setShowGaps] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [panelStyle, setPanelStyle] = useState<'floating' | 'docked'>('floating')

  const pinsQuery = useQuery({
    queryKey: ['gis', 'cameras-in-bounds', bounds],
    queryFn: () => gisApi.getCamerasInBounds(bounds!),
    enabled: Boolean(bounds),
  })

  const gapQuery = useQuery({
    queryKey: ['gis', 'gap-analysis', bounds],
    queryFn: () => gisApi.getGapAnalysis(bounds!, 10),
    enabled: Boolean(bounds) && showGaps,
  })

  const heatmapQuery = useQuery({
    queryKey: ['gis', 'heatmap'],
    queryFn: () => gisApi.getHeatmap(),
    enabled: showHeatmap,
    staleTime: Infinity, // static sample data — never needs refetching
  })

  const legend = useMemo(() => {
    const pins = pinsQuery.data ?? []
    if (colorMode === 'status') {
      return STATUS_LEGEND.map((row) => ({
        ...row,
        count: pins.filter((p) => p.currentStatus === row.statusKey).length,
      }))
    }
    return SCORE_LEGEND.map((row) => ({
      ...row,
      count: pins.filter((p) => p.integrationScore === row.statusKey).length,
    }))
  }, [pinsQuery.data, colorMode])

  const visibleCount = pinsQuery.data?.length ?? 0

  return (
    <div className="relative flex h-[calc(100vh-56px)]">
      {panelStyle === 'docked' && (
        <div className="w-[304px] shrink-0 overflow-auto border-r border-[var(--border-default)] bg-[var(--bg-surface)] p-[18px]">
          <FiltersPanel
            colorMode={colorMode}
            setColorMode={setColorMode}
            showGaps={showGaps}
            setShowGaps={setShowGaps}
            showHeatmap={showHeatmap}
            setShowHeatmap={setShowHeatmap}
            docked
          />
          <p className="mb-3 mt-5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Legend</p>
          {legend.map((row) => (
            <LegendRow key={row.statusKey} {...row} />
          ))}
        </div>
      )}

      <div className="relative flex-1">
        <MapContainer center={GUJARAT_CENTER} zoom={7} className="h-full w-full" zoomControl={false}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <ViewportTracker onBoundsChange={onBoundsChange} />

          {pinsQuery.data?.map((pin) => (
            <CameraPinMarker key={pin.cameraId} pin={pin} colorMode={colorMode} />
          ))}

          {showGaps && gapQuery.data && <GapOverlay gaps={gapQuery.data.gaps} />}
          {showHeatmap && heatmapQuery.data && <HeatmapLayer points={heatmapQuery.data.points} />}
        </MapContainer>

        {panelStyle === 'floating' && (
          <div className="absolute left-4 top-4 z-[1000] w-[272px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-glass)] p-3.5 shadow-[var(--shadow-float)] backdrop-blur-[14px]">
            <FiltersPanel
              colorMode={colorMode}
              setColorMode={setColorMode}
              showGaps={showGaps}
              setShowGaps={setShowGaps}
              showHeatmap={showHeatmap}
              setShowHeatmap={setShowHeatmap}
            />
          </div>
        )}

        {panelStyle === 'floating' && (
          <div className="absolute bottom-4 left-4 z-[1000] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-glass)] p-3.5 shadow-[var(--shadow-float)] backdrop-blur-[14px]">
            {legend.map((row) => (
              <LegendRow key={row.statusKey} {...row} />
            ))}
          </div>
        )}

        <div className="absolute right-4 top-4 z-[1000] flex items-center gap-2 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-glass)] py-1.5 pl-3 pr-1.5 backdrop-blur-[14px]">
          <span className="text-xs text-[var(--text-secondary)]">Panel</span>
          <div className="flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] p-0.5">
            <button
              onClick={() => setPanelStyle('floating')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors duration-150',
                panelStyle === 'floating' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
              )}>
              A · Floating
            </button>
            <button
              onClick={() => setPanelStyle('docked')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors duration-150',
                panelStyle === 'docked' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
              )}>
              B · Docked
            </button>
          </div>
        </div>

        <div className="absolute bottom-4 right-4 z-[1000] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-glass)] px-[13px] py-2.5 text-[12.5px] text-[var(--text-secondary)] backdrop-blur-[14px]">
          <span className="font-mono text-[var(--text-primary)]">{visibleCount}</span> camera{visibleCount === 1 ? '' : 's'} in view
        </div>
      </div>
    </div>
  )
}

function LegendRow({ label, color, count }: { label: string; color: string; count: number }) {
  return (
    <div className="flex items-center gap-[9px] py-[3px] text-[12.5px] text-[var(--text-secondary)]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {label}
      <span className="flex-1" />
      <span className="font-mono text-xs text-[var(--text-primary)]">{count}</span>
    </div>
  )
}

function FiltersPanel({
  colorMode,
  setColorMode,
  showGaps,
  setShowGaps,
  showHeatmap,
  setShowHeatmap,
  docked,
}: {
  colorMode: 'status' | 'score'
  setColorMode: (mode: 'status' | 'score') => void
  showGaps: boolean
  setShowGaps: (v: boolean) => void
  showHeatmap: boolean
  setShowHeatmap: (v: boolean) => void
  docked?: boolean
}) {
  return (
    <div>
      {!docked && (
        <div className="mb-3 flex items-center gap-2">
          <input
            placeholder="Filter cameras"
            className="h-[30px] flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] px-2.5 text-[12.5px]"
          />
        </div>
      )}

      <div className={cn('mb-3 flex rounded-lg border border-[var(--border-default)] p-[3px]', docked ? 'bg-[var(--bg-surface-raised)]' : 'bg-[var(--bg-canvas)]')}>
        <button
          onClick={() => setColorMode('status')}
          className={cn(
            'flex-1 rounded-md py-1.5 text-center text-xs transition-colors duration-150',
            colorMode === 'status' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
          )}>
          Status
        </button>
        <button
          onClick={() => setColorMode('score')}
          className={cn(
            'flex-1 rounded-md py-1.5 text-center text-xs transition-colors duration-150',
            colorMode === 'score' ? 'bg-[var(--bg-surface-sunken)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
          )}>
          Integration
        </button>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 py-[7px]">
        <Toggle checked={showGaps} onChange={setShowGaps} />
        <span className="flex-1 text-[12.5px]">Coverage gaps</span>
      </label>

      <label className="flex cursor-pointer items-center gap-2.5 py-[7px]">
        <Toggle checked={showHeatmap} onChange={setShowHeatmap} />
        <span className="flex-1 text-[12.5px]">Incident heatmap</span>
        <BetaBadge />
      </label>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative h-[17px] w-7 shrink-0 rounded-full transition-colors duration-150"
      style={{ background: checked ? 'var(--color-brand)' : 'var(--border-strong)' }}>
      <span
        className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left] duration-150"
        style={{ left: checked ? '14px' : '2px' }}
      />
    </button>
  )
}
