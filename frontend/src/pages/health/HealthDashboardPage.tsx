import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Info } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { CurrentStatusPill } from '@/components/ui/StatusPill'
import { SkeletonStack } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Select'
import { useDepartments } from '@/hooks/useDepartments'
import * as healthApi from '@/api/health'

type SortMode = 'offlineCount' | 'department' | 'name'

// Pixel-matched to the reference (Sentinel.dc.html) At-risk screen: a
// "Total at risk" stat tile + a live "By department" mini bar chart next to
// it, then a dense data-grid table (Camera/Department/Status/Offline events
// / View history) — replacing the previous card-list layout.
export function HealthDashboardPage() {
  usePageTitle('Health / At-Risk Dashboard')
  const navigate = useNavigate()
  const [sortMode, setSortMode] = useState<SortMode>('offlineCount')
  const { data: departments = [] } = useDepartments()

  const atRiskQuery = useQuery({
    queryKey: ['health', 'at-risk'],
    queryFn: () => healthApi.getAtRiskCameras(),
  })

  const deptName = (departmentId: string) => departments.find((d) => d.departmentId === departmentId)?.name ?? departmentId

  const deptBars = useMemo(() => {
    const cameras = atRiskQuery.data ?? []
    const counts = new Map<string, number>()
    for (const c of cameras) counts.set(c.departmentId, (counts.get(c.departmentId) ?? 0) + 1)
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const max = rows[0]?.[1] ?? 1
    return { rows, max }
  }, [atRiskQuery.data])

  if (atRiskQuery.isLoading) {
    return (
      <div className="p-6">
        <SkeletonStack count={5} rowClassName="h-14" />
      </div>
    )
  }

  if (!atRiskQuery.data || atRiskQuery.data.length === 0) {
    return (
      <div className="p-6">
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-20 text-center">
          <span className="mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-status-online-bg)] text-[var(--color-status-online)]">
            <CheckCircle2 className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </span>
          <p className="text-lg font-semibold">No cameras are currently at risk</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Nice work.</p>
        </div>
      </div>
    )
  }

  const sorted = [...atRiskQuery.data].sort((a, b) => {
    if (sortMode === 'offlineCount') return b.offlineCount - a.offlineCount
    if (sortMode === 'name') return a.name.localeCompare(b.name)
    return deptName(a.departmentId).localeCompare(deptName(b.departmentId))
  })

  return (
    <div className="p-6">
      <div className="mb-5 flex items-start justify-between gap-5">
        <div>
          <p className="text-[22px] font-semibold tracking-tight">At-risk cameras</p>
          <p className="text-[13px] text-[var(--text-secondary)]">3 or more offline events in the trailing 14 days.</p>
        </div>
        <div className="flex gap-3">
          <div className="min-w-[120px] rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[18px] py-3.5">
            <p className="text-[12.5px] text-[var(--text-secondary)]">Total at risk</p>
            <p className="font-mono text-[28px] font-semibold tabular-nums text-[var(--color-status-offline)]">
              {atRiskQuery.data.length}
            </p>
          </div>
          <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] px-[18px] py-3.5">
            <p className="mb-2 text-[12.5px] text-[var(--text-secondary)]">By department</p>
            <div className="flex h-7 items-end gap-1.5">
              {deptBars.rows.map(([departmentId, count], i) => (
                <div
                  key={departmentId}
                  title={`${deptName(departmentId)} · ${count} at risk`}
                  className="w-4 rounded-[3px] bg-[var(--color-status-offline)]"
                  style={{ height: `${Math.max((count / deptBars.max) * 100, 14)}%`, opacity: Math.max(0.5 - i * 0.05, 0.2) }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
          <Info className="h-3.5 w-3.5" />
          Sorted by {sortMode === 'offlineCount' ? 'offline count' : sortMode === 'department' ? 'department' : 'name'}
        </p>
        <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="w-44">
          <option value="offlineCount">Sort: Offline count</option>
          <option value="department">Sort: Department</option>
          <option value="name">Sort: Name</option>
        </Select>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[900px] gap-3 border-b border-[var(--border-default)] px-[18px] py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            style={{ gridTemplateColumns: 'minmax(220px,2fr) minmax(130px,1.2fr) 120px 130px 110px' }}>
            <div>Camera</div>
            <div>Department</div>
            <div>Status</div>
            <div>Offline events</div>
            <div />
          </div>
          {sorted.map((camera) => (
            <div
              key={camera.cameraId}
              onClick={() => navigate(`/cameras/${camera.cameraId}`)}
              className="grid min-w-[900px] cursor-pointer items-center gap-3 border-b border-[var(--border-default)] px-[18px] py-[13px] last:border-b-0 hover:bg-[var(--bg-surface-raised)]"
              style={{ gridTemplateColumns: 'minmax(220px,2fr) minmax(130px,1.2fr) 120px 130px 110px' }}>
              <div>
                <p className="text-[13.5px] font-medium">{camera.name}</p>
                <p className="font-mono text-[11.5px] text-[var(--text-secondary)]">{camera.cameraId}</p>
              </div>
              <p className="text-[12.5px] text-[var(--text-secondary)]">{deptName(camera.departmentId)}</p>
              <div>
                <CurrentStatusPill status={camera.currentStatus} />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xl font-semibold tabular-nums text-[var(--color-status-offline)]">{camera.offlineCount}</span>
                <span className="text-xs text-[var(--text-secondary)]">/ 14d</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/cameras/${camera.cameraId}?tab=health`) }}
                className="text-left text-[12.5px] font-medium text-[var(--color-brand)] hover:underline">
                View history →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
