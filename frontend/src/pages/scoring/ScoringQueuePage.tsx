import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { usePageTitle } from '@/hooks/usePageTitle'
import { SkeletonStack } from '@/components/ui/Skeleton'
import * as scoringApi from '@/api/scoring'
import type { PendingVerification } from '@/types/api'

// Pixel-matched to the reference (Sentinel.dc.html) verification queue:
// single-column full-width cards, purple "AI GUESS" badge, a left-accented
// quote block for the AI's reasoning, and one-step Confirm yes / Confirm no
// / Reject actions side by side (no intermediate "choose how to confirm"
// step — the reference commits directly on click).
export function ScoringQueuePage() {
  usePageTitle('Scoring Verification Queue')

  const queueQuery = useQuery({
    queryKey: ['scoring', 'pending-verification'],
    queryFn: () => scoringApi.listPendingVerifications({ page: 1, limit: 50 }),
  })

  if (queueQuery.isLoading) {
    return (
      <div className="p-6">
        <SkeletonStack count={3} rowClassName="h-32" gap={3} />
      </div>
    )
  }

  if (!queueQuery.data || queueQuery.data.length === 0) {
    return (
      <div className="p-6">
        <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] py-20 text-center">
          <span className="mb-3.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-status-online-bg)] text-[var(--color-status-online)]">
            <CheckCircle2 className="h-[22px] w-[22px]" strokeWidth={2.4} />
          </span>
          <p className="text-lg font-semibold">You're all caught up</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Every AI suggestion has been reviewed. New ones appear here automatically.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <p className="text-[22px] font-semibold tracking-tight">Verification queue</p>
        <p className="text-[13px] text-[var(--text-secondary)]">
          The AI suggests. You decide. Confirmed answers resolve instantly forever after.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {queueQuery.data.map((item) => (
          <VerificationCard key={item.verificationId} item={item} />
        ))}
      </div>
    </div>
  )
}

function VerificationCard({ item }: { item: PendingVerification }) {
  const queryClient = useQueryClient()

  const verifyMutation = useMutation({
    mutationFn: (args: { decision: 'confirm' | 'reject'; finalOnvifStatus?: 'yes' | 'no' }) =>
      scoringApi.verifyScoring(item.verificationId, args.decision, args.finalOnvifStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring', 'pending-verification'] })
    },
  })

  const pendingAction = verifyMutation.variables
    ? verifyMutation.variables.decision === 'confirm'
      ? verifyMutation.variables.finalOnvifStatus
      : 'reject'
    : undefined

  return (
    <div className="flex items-start gap-5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2.5">
          <span className="text-[15px] font-semibold">{item.cameraName}</span>
          <span className="rounded-full bg-[var(--color-status-ai-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-status-ai)]">
            AI GUESS
          </span>
        </div>
        <p className="mb-3 font-mono text-[12.5px] text-[var(--text-secondary)]">
          {item.brand ?? 'Unbranded'} · {item.model ?? '—'}
        </p>
        {item.aiConfidenceNote && (
          <div className="rounded-r-[10px] border-l-2 border-[var(--color-status-ai)] bg-[var(--bg-surface-raised)] px-3.5 py-3 text-[13px] text-[var(--text-secondary)]">
            "{item.aiConfidenceNote}"
          </div>
        )}
      </div>
      <div className="w-[200px] shrink-0">
        <p className="mb-2 text-xs text-[var(--text-secondary)]">
          Suggested ONVIF: <span className="font-semibold text-[var(--text-primary)]">{item.aiSuggestedOnvif ?? 'Unsure'}</span>
        </p>
        <div className="mb-1.5 flex gap-1.5">
          <button
            onClick={() => verifyMutation.mutate({ decision: 'confirm', finalOnvifStatus: 'yes' })}
            disabled={verifyMutation.isPending}
            className="flex-1 rounded-lg bg-[var(--color-brand)] py-2 text-center text-[12.5px] font-semibold text-white transition-[filter] duration-150 hover:brightness-110 disabled:opacity-60">
            {verifyMutation.isPending && pendingAction === 'yes' ? '…' : 'Confirm yes'}
          </button>
          <button
            onClick={() => verifyMutation.mutate({ decision: 'confirm', finalOnvifStatus: 'no' })}
            disabled={verifyMutation.isPending}
            className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-2 text-center text-[12.5px] font-semibold transition-colors duration-150 hover:border-[var(--border-strong)] disabled:opacity-60">
            {verifyMutation.isPending && pendingAction === 'no' ? '…' : 'Confirm no'}
          </button>
        </div>
        <button
          onClick={() => verifyMutation.mutate({ decision: 'reject' })}
          disabled={verifyMutation.isPending}
          className="w-full rounded-lg border border-[var(--border-default)] py-2 text-center text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:border-[var(--border-strong)] disabled:opacity-60">
          {verifyMutation.isPending && pendingAction === 'reject' ? '…' : 'Reject'}
        </button>
        <p className="mt-2.5 text-center font-mono text-[11.5px] text-[var(--text-secondary)]">
          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
        </p>
        {verifyMutation.isError && (
          <p className="mt-2 text-center text-xs text-[var(--color-status-offline)]">Could not save — try again.</p>
        )}
      </div>
    </div>
  )
}
