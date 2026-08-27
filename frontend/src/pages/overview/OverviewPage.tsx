import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAuth } from '@/contexts/AuthContext'
import { StatTile } from '@/components/shared/StatTile'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/Button'
import { NetworkCoverageMap } from './NetworkCoverageMap'
import { useCameraList } from '@/hooks/useCameras'
import * as scoringApi from '@/api/scoring'
import * as healthApi from '@/api/health'

// Pixel-matched to the reference (Sentinel.dc.html) "A · Tiles" layout:
// stat-tile row -> attention panel -> a real live map by default
// (NetworkCoverageMap), not a text card linking to one.
export function OverviewPage() {
  usePageTitle('Overview')
  const { user } = useAuth()
  const navigate = useNavigate()

  const camerasQuery = useCameraList({ isActive: true, limit: 100 })

  const pendingVerificationsQuery = useQuery({
    queryKey: ['scoring', 'pending-verification', 'count'],
    queryFn: () => scoringApi.listPendingVerifications({ limit: 100 }),
    enabled: user?.role === 'admin',
  })

  const atRiskQuery = useQuery({
    queryKey: ['health', 'at-risk'],
    queryFn: () => healthApi.getAtRiskCameras(),
    enabled: user?.role === 'admin' || user?.role === 'field_officer',
  })

  const totalCameras = camerasQuery.data?.length ?? 0
  const onlineCount = camerasQuery.data?.filter((c) => c.currentStatus === 'online').length ?? 0
  const onlinePercent = totalCameras > 0 ? Math.round((onlineCount / totalCameras) * 100) : 0

  const isEmpty = camerasQuery.data?.length === 0 && !camerasQuery.isLoading

  if (isEmpty) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Camera}
          title="No cameras registered yet"
          description="Get started by adding your first camera to the registry."
          action={
            <Button onClick={() => navigate('/cameras/new')}>+ Add your first camera</Button>
          }
        />
      </div>
    )
  }

  const showAttention = user?.role === 'admin' || user?.role === 'field_officer'

  return (
    <div className="space-y-3 p-6 pb-14">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Total cameras"
          value={totalCameras}
          secondaryLine={`${onlineCount} active · ${totalCameras - onlineCount} other`}
          isLoading={camerasQuery.isLoading}
          hasError={camerasQuery.isError}
          onClick={() => navigate('/cameras')}
        />
        <StatTile
          label="Online now"
          value={`${onlinePercent}%`}
          accent="brand"
          isLoading={camerasQuery.isLoading}
          hasError={camerasQuery.isError}
        />
        {user?.role !== 'dept_viewer' && user?.role !== 'auditor' && (
          <StatTile
            label="At-risk cameras"
            value={atRiskQuery.data?.length ?? 0}
            secondaryLine="3+ offline events / 14 days"
            accent="offline"
            isLoading={atRiskQuery.isLoading}
            hasError={atRiskQuery.isError}
            onClick={() => navigate('/health')}
          />
        )}
        {user?.role === 'admin' && (
          <StatTile
            label="Pending verifications"
            value={pendingVerificationsQuery.data?.length ?? 0}
            secondaryLine="AI-suggested, awaiting review"
            accent="ai"
            isLoading={pendingVerificationsQuery.isLoading}
            hasError={pendingVerificationsQuery.isError}
            onClick={() => navigate('/scoring')}
          />
        )}
      </div>

      {showAttention && (
        <NeedsAttentionPanel
          pendingVerifications={pendingVerificationsQuery.data?.length ?? 0}
          atRiskCameras={atRiskQuery.data?.length ?? 0}
        />
      )}

      <NetworkCoverageMap />
    </div>
  )
}

function NeedsAttentionPanel({
  pendingVerifications,
  atRiskCameras,
}: {
  pendingVerifications: number
  atRiskCameras: number
}) {
  const navigate = useNavigate()
  const hasAnything = pendingVerifications > 0 || atRiskCameras > 0

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-default)] px-[18px] py-4">
        <p className="text-base font-semibold">Needs your attention</p>
      </div>
      {!hasAnything ? (
        <p className="px-[18px] py-6 text-sm text-[var(--text-secondary)]">You're all caught up. Nothing needs review right now.</p>
      ) : (
        <div>
          {pendingVerifications > 0 && (
            <AttentionRow
              color="var(--color-status-ai)"
              title={`${pendingVerifications} camera${pendingVerifications === 1 ? '' : 's'} awaiting scoring verification`}
              sub="AI-suggested — awaiting admin review"
              actionLabel="Review"
              onAction={() => navigate('/scoring')}
            />
          )}
          {atRiskCameras > 0 && (
            <AttentionRow
              color="var(--color-status-offline)"
              title={`${atRiskCameras} camera${atRiskCameras === 1 ? '' : 's'} trending toward failure`}
              sub="3+ offline events in the trailing 14 days"
              actionLabel="Investigate"
              onAction={() => navigate('/health')}
            />
          )}
        </div>
      )}
    </div>
  )
}

function AttentionRow({
  color,
  title,
  sub,
  actionLabel,
  onAction,
}: {
  color: string
  title: string
  sub: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex items-center gap-3.5 border-b border-[var(--border-default)] px-[18px] py-3.5 transition-colors duration-150 last:border-0 hover:bg-[var(--bg-surface-raised)]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{title}</p>
        <p className="truncate text-[12.5px] text-[var(--text-secondary)]">{sub}</p>
      </div>
      <button
        onClick={onAction}
        className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3 py-[5px] text-[12.5px] font-medium transition-colors duration-150 hover:border-[var(--border-strong)]">
        {actionLabel}
      </button>
    </div>
  )
}
