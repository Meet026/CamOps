import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { getApiErrorMessage, getApiErrorStatus } from '@/api/client'
import * as authApi from '@/api/auth'

// Pixel/copy-matched to the reference (Sentinel.dc.html) Settings 2FA
// card and its setup/disable/regenerate modal (`tf*` state in the
// reference). Wired to the real API per the frontend TOTP PRD rather than
// the reference's mock state machine — see docs/superpowers/specs/
// 2026-09-12-totp-two-factor-auth-frontend-prd.md in model1-service.
type ModalIntent = 'enable' | 'disable' | 'regenerate' | null
type EnableStep = 'scan' | 'codes'

export function TwoFactorAuthSection() {
  const queryClient = useQueryClient()
  const [intent, setIntent] = useState<ModalIntent>(null)

  const { data: status, isLoading } = useQuery({
    queryKey: ['auth', 'totp', 'status'],
    queryFn: () => authApi.getTotpStatus(),
  })

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: ['auth', 'totp', 'status'] })

  const enabled = status?.enabled ?? false

  return (
    <div className="border-t border-[var(--border-default)] px-5 py-[18px]">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-[13.5px] font-medium">Two-factor authentication</span>
            {!isLoading && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold',
                  enabled
                    ? 'bg-[var(--color-status-online-bg)] text-[var(--color-status-online)]'
                    : 'bg-[var(--bg-surface-sunken)] text-[var(--text-secondary)]',
                )}
              >
                <span
                  className={cn(
                    'h-[5px] w-[5px] rounded-full',
                    enabled ? 'bg-[var(--color-status-online)]' : 'bg-[var(--text-secondary)]',
                  )}
                />
                {enabled ? 'Enabled' : 'Not enabled'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)] text-balance">
            {enabled
              ? 'A verification code from your authenticator app is required at sign-in.'
              : 'Require a verification code from an authenticator app at sign-in, in addition to your password.'}
          </p>
        </div>

        {!isLoading && !enabled && (
          <Button size="sm" onClick={() => setIntent('enable')} className="flex-none">
            Enable
          </Button>
        )}
        {!isLoading && enabled && (
          <div className="flex flex-none flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setIntent('regenerate')}>
              Generate new backup codes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIntent('disable')}
              className="text-[var(--color-status-offline)] hover:bg-[var(--color-status-offline-bg)]"
            >
              Disable
            </Button>
          </div>
        )}
      </div>

      {intent === 'enable' && <EnableModal onClose={() => setIntent(null)} onEnabled={invalidateStatus} />}
      {intent === 'disable' && <DisablePasswordModal onClose={() => setIntent(null)} onDisabled={invalidateStatus} />}
      {intent === 'regenerate' && <RegenerateModal onClose={() => setIntent(null)} />}
    </div>
  )
}

function ModalShell({
  title,
  subtitle,
  dismissable = true,
  onClose,
  width = 460,
  children,
}: {
  title: string
  subtitle: string
  dismissable?: boolean
  onClose: () => void
  width?: number
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[75] flex justify-center overflow-auto bg-black/55 p-4 pt-[8vh] backdrop-blur-[3px]">
      <div
        className="h-fit max-w-[94vw] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-float)]"
        style={{ width }}
      >
        <div className="flex items-start gap-3.5 border-b border-[var(--border-default)] px-5 py-[18px]">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold tracking-tight text-balance">{title}</p>
            <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)] text-balance">{subtitle}</p>
          </div>
          {dismissable && (
            <button
              onClick={onClose}
              className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

function EnableModal({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [step, setStep] = useState<EnableStep>('scan')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [ack, setAck] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data: setup, isLoading } = useQuery({
    queryKey: ['auth', 'totp', 'setup'],
    queryFn: () => authApi.setupTotp(),
    staleTime: Infinity,
  })

  const handleConfirm = async () => {
    setCodeError(null)
    setIsBusy(true)
    try {
      const result = await authApi.confirmTotp(code)
      setBackupCodes(result.backupCodes)
      setStep('codes')
    } catch (err) {
      const status = getApiErrorStatus(err)
      setCodeError(
        status === 401
          ? 'Invalid code — two-factor authentication is not enabled yet. Codes expire every 30 seconds, so try the current one.'
          : getApiErrorMessage(err, 'Could not confirm this code.'),
      )
      setCode('')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCopySecret = () => {
    if (setup) void navigator.clipboard.writeText(setup.secret)
  }

  const handleCopyCodes = () => {
    void navigator.clipboard.writeText(backupCodes.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    const blob = new Blob([backupCodes.join('\n') + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sentinel-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFinish = () => {
    onEnabled()
    onClose()
  }

  return (
    <ModalShell
      title={step === 'scan' ? 'Set up two-factor authentication' : 'Two-factor authentication enabled'}
      subtitle={
        step === 'scan'
          ? 'Scan the QR code with your authenticator app, then confirm with the code it shows.'
          : 'Two-factor authentication is now on.'
      }
      dismissable={step === 'scan'}
      onClose={onClose}
      width={step === 'scan' ? 560 : 460}
    >
      {step === 'scan' && (
        <>
          <div className="flex flex-wrap gap-[22px] p-5">
            <div className="flex h-[184px] w-[184px] flex-none items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-white p-2.5">
              {isLoading || !setup ? (
                <div className="h-full w-full animate-pulse rounded bg-gray-200" />
              ) : (
                <QRCodeSVG value={setup.otpauthUrl} size={164} />
              )}
            </div>
            <div className="min-w-[220px] flex-1">
              <ol className="list-decimal space-y-1.5 pl-[18px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
                <li>Open your authenticator app.</li>
                <li>Scan this code, or enter the key below by hand.</li>
                <li>Type the 6-digit code it shows to confirm.</li>
              </ol>
              <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Setup key
              </p>
              <div className="mt-[7px] flex items-center gap-2">
                <div className="min-w-0 flex-1 break-all rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)] px-3 py-2.5 font-mono text-[13.5px] tracking-wide">
                  {setup?.secret ?? '········'}
                </div>
                <Button variant="secondary" size="sm" onClick={handleCopySecret} disabled={!setup} className="flex-none">
                  Copy
                </Button>
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Time-based, 6 digits, refreshes every 30 seconds.
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--border-default)] px-5 pb-5 pt-[18px]">
            <label htmlFor="setup-code" className="mb-2 block text-[12.5px] font-medium">
              Enter the 6-digit code from your app
            </label>
            <div className="flex flex-wrap gap-2.5">
              <input
                id="setup-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="482913"
                autoComplete="one-time-code"
                className={cn(
                  'h-[46px] min-w-[160px] flex-1 rounded-[10px] border bg-[var(--bg-canvas)] px-3.5 text-center font-mono text-[19px] tracking-[0.2em] text-[var(--text-primary)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]',
                  codeError ? 'border-[var(--color-status-offline)]' : 'border-[var(--border-default)]',
                )}
              />
              <Button onClick={handleConfirm} isLoading={isBusy} disabled={code.length === 0} className="h-[46px] flex-none px-5">
                Confirm
              </Button>
            </div>
            {codeError && (
              <div className="mt-3 flex items-start gap-2.5 rounded-[10px] border border-[var(--color-status-offline)]/40 bg-[var(--color-status-offline-bg)] px-3.5 py-[11px]">
                <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-[var(--color-status-offline)]" />
                <p className="flex-1 text-[12.5px] text-balance">{codeError}</p>
              </div>
            )}
          </div>
        </>
      )}

      {step === 'codes' && (
        <div className="p-5">
          <div className="mb-[18px] flex items-start gap-2.5 rounded-[10px] border border-[var(--color-status-unknown)]/40 bg-[var(--color-status-unknown-bg)] px-[15px] py-[13px]">
            <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--color-status-unknown)]/20 text-[var(--color-status-unknown)]">
              !
            </span>
            <p className="flex-1 text-[13px] text-balance">
              <span className="font-semibold">Save these now — this is the only time they are shown.</span> They
              cannot be retrieved later. Each code works once if you lose access to your authenticator app.
            </p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--border-default)]">
            {backupCodes.map((c, i) => (
              <div key={c} className="flex items-center gap-2.5 bg-[var(--bg-surface)] px-3.5 py-[11px]">
                <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[13.5px] tracking-wide">{c}</span>
              </div>
            ))}
          </div>

          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleCopyCodes}>
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy all'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              Download .txt
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setAck((a) => !a)}
            className="mt-5 flex w-full items-start gap-2.5 border-t border-[var(--border-default)] pt-4 text-left"
          >
            <span
              className={cn(
                'mt-px flex h-[17px] w-[17px] flex-none items-center justify-center rounded-[5px] border transition-colors duration-150',
                ack ? 'border-[var(--color-brand)] bg-[var(--color-brand)]' : 'border-[var(--border-strong)]',
              )}
            >
              {ack && <Check className="h-[11px] w-[11px] text-white" strokeWidth={3.4} />}
            </span>
            <span className="flex-1 text-[13px] text-balance">I've saved my backup codes somewhere safe.</span>
          </button>

          <Button className="mt-4 w-full" disabled={!ack} onClick={handleFinish}>
            Done
          </Button>
        </div>
      )}
    </ModalShell>
  )
}

function DisablePasswordModal({ onClose, onDisabled }: { onClose: () => void; onDisabled: () => void }) {
  return (
    <PasswordConfirmModal
      title="Disable two-factor authentication"
      subtitle="For your security, please confirm your password to turn off two-factor authentication."
      warning="Turning this off deletes all 10 of your backup codes. Sign-in will need only your password again."
      warningTone="offline"
      confirmLabel="Turn off two-factor"
      busyLabel="Confirming…"
      errorTail="Two-factor authentication is still on."
      onClose={onClose}
      onSubmit={async (password) => {
        await authApi.disableTotp(password)
      }}
      onSuccess={() => {
        onDisabled()
        onClose()
      }}
    />
  )
}

function RegenerateModal({ onClose }: { onClose: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCopyCodes = () => {
    if (!codes) return
    void navigator.clipboard.writeText(codes.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = () => {
    if (!codes) return
    const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sentinel-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (codes) {
    return (
      <ModalShell
        title="Generate new backup codes"
        subtitle="10 new codes. Your previous codes no longer work."
        onClose={onClose}
        width={460}
      >
        <div className="p-5">
          <div className="mb-[18px] flex items-start gap-2.5 rounded-[10px] border border-[var(--color-status-unknown)]/40 bg-[var(--color-status-unknown-bg)] px-[15px] py-[13px]">
            <span className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--color-status-unknown)]/20 text-[var(--color-status-unknown)]">
              !
            </span>
            <p className="flex-1 text-[13px] text-balance">
              <span className="font-semibold">Save these now — this is the only time they are shown.</span> They
              cannot be retrieved later. Each code works once if you lose access to your authenticator app.
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden rounded-[10px] border border-[var(--border-default)] bg-[var(--border-default)]">
            {codes.map((c, i) => (
              <div key={c} className="flex items-center gap-2.5 bg-[var(--bg-surface)] px-3.5 py-[11px]">
                <span className="font-mono text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[13.5px] tracking-wide">{c}</span>
              </div>
            ))}
          </div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleCopyCodes}>
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy all'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              Download .txt
            </Button>
          </div>
          <Button className="mt-5 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      </ModalShell>
    )
  }

  return (
    <PasswordConfirmModal
      title="Generate new backup codes"
      subtitle="For your security, please confirm your password to generate new backup codes."
      warning="Your existing 10 backup codes stop working the instant new ones are generated."
      warningTone="unknown"
      confirmLabel="Generate new codes"
      busyLabel="Confirming…"
      errorTail="Your existing codes are unchanged."
      onClose={onClose}
      onSubmit={async (password) => {
        const result = await authApi.regenerateBackupCodes(password)
        setCodes(result.backupCodes)
      }}
    />
  )
}

// Shared shape for the disable and regenerate flows — both are a single
// "confirm current password" step before a consequential 2FA change,
// matching the reference's `tfStepPassword` modal state exactly.
function PasswordConfirmModal({
  title,
  subtitle,
  warning,
  warningTone,
  confirmLabel,
  busyLabel,
  errorTail,
  onClose,
  onSubmit,
  onSuccess,
}: {
  title: string
  subtitle: string
  warning: string
  warningTone: 'offline' | 'unknown'
  confirmLabel: string
  busyLabel: string
  errorTail: string
  onClose: () => void
  onSubmit: (password: string) => Promise<void>
  onSuccess?: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const handleSubmit = async () => {
    setError(null)
    setIsBusy(true)
    try {
      await onSubmit(password)
      onSuccess?.()
      if (!onSuccess) onClose()
    } catch (err) {
      const status = getApiErrorStatus(err)
      setError(
        status === 401
          ? `Current password is incorrect. ${errorTail}`
          : getApiErrorMessage(err, 'Something went wrong.'),
      )
      setIsBusy(false)
    }
  }

  return (
    <ModalShell title={title} subtitle={subtitle} onClose={onClose} width={440}>
      <div className="p-5">
        <label htmlFor="tf-password" className="mb-2 block text-[12.5px] font-medium">
          Current password
        </label>
        <Input
          id="tf-password"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hasError={!!error}
          autoFocus
        />
        {error && (
          <div className="mt-3 flex items-start gap-2.5 rounded-[10px] border border-[var(--color-status-offline)]/40 bg-[var(--color-status-offline-bg)] px-3.5 py-[11px]">
            <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-[var(--color-status-offline)]" />
            <p className="flex-1 text-[12.5px]">{error}</p>
          </div>
        )}
        <div
          className={cn(
            'mt-4 flex items-start gap-2.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-3.5 py-3',
          )}
        >
          <span
            className={cn(
              'mt-1.5 h-[7px] w-[7px] flex-none rounded-full',
              warningTone === 'offline' ? 'bg-[var(--color-status-offline)]' : 'bg-[var(--color-status-unknown)]',
            )}
          />
          <p className="flex-1 text-[12.5px] text-[var(--text-secondary)] text-balance">{warning}</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            className="h-11 min-w-[160px] flex-1"
            onClick={handleSubmit}
            isLoading={isBusy}
            disabled={password.length === 0}
          >
            {isBusy ? busyLabel : confirmLabel}
          </Button>
          <Button variant="secondary" className="h-11 flex-none px-[18px]" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}
