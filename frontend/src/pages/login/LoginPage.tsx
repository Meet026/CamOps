import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, ShieldHalf, ArrowLeft, Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { getApiErrorMessage, getApiErrorStatus } from '@/api/client'
import { cn } from '@/lib/utils'
import { MapBackdrop } from './MapBackdrop'

type LoginStep = 'password' | 'totp'

export function LoginPage() {
  const { login, completeTotpLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [step, setStep] = useState<LoginStep>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitedSecondsLeft, setRateLimitedSecondsLeft] = useState(0)
  const [shake, setShake] = useState(false)

  // 2FA challenge state — mfaToken lives only here, in memory, for the
  // ~5-minute lifetime of the challenge. It is never written to the token
  // store, never persisted, and never sent as an Authorization header.
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isCodeRateLimited, setIsCodeRateLimited] = useState(false)

  // Set by SettingsPage after a successful password change — a real
  // redirect-with-reason, not a silent bounce to the login screen.
  const redirectMessage = (location.state as { message?: string } | null)?.message ?? null

  const navigateAfterLogin = () => {
    const from = (location.state as { from?: string } | null)?.from ?? '/'
    setTimeout(() => navigate(from, { replace: true }), 150)
  }

  const handleSubmitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await login(email, password)
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken)
        setStep('totp')
        setIsSubmitting(false)
        return
      }
      setIsSuccess(true)
      navigateAfterLogin()
    } catch (err) {
      const status = getApiErrorStatus(err)
      if (status === 429) {
        setError('Too many attempts — try again in a moment.')
        setRateLimitedSecondsLeft(60)
        const interval = setInterval(() => {
          setRateLimitedSecondsLeft((prev) => {
            if (prev <= 1) {
              clearInterval(interval)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      } else {
        setError(getApiErrorMessage(err, "That email or password doesn't look right."))
        setShake(true)
        setTimeout(() => setShake(false), 300)
      }
      setIsSubmitting(false)
    }
  }

  const handleBackToPassword = () => {
    setStep('password')
    setMfaToken(null)
    setCode('')
    setCodeError(null)
    setIsCodeRateLimited(false)
  }

  const handleSubmitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!mfaToken) return
    setCodeError(null)
    setIsSubmitting(true)

    try {
      await completeTotpLogin(mfaToken, code)
      setIsSuccess(true)
      navigateAfterLogin()
    } catch (err) {
      const status = getApiErrorStatus(err)
      if (status === 429) {
        setCodeError('Too many attempts. Try again in a moment.')
        setIsCodeRateLimited(true)
      } else if (status === 401 && getApiErrorMessage(err, '').toLowerCase().includes('expired')) {
        // mfaToken expired (5-minute lifetime) — the challenge is dead,
        // send the user back to the start of login rather than let them
        // keep retrying a code against a token that can't succeed.
        handleBackToPassword()
        setError('That took too long — please log in again.')
        setIsSubmitting(false)
        return
      } else {
        setCodeError('Invalid code. Check your app and try again.')
      }
      setCode('')
      setIsSubmitting(false)
    }
  }

  const isLocked = rateLimitedSecondsLeft > 0

  return (
    <div className="flex min-h-screen">
      {/* Left: form panel — ~45% */}
      <div className="flex w-full flex-col justify-center px-8 py-12 md:w-[45%] md:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <ShieldHalf className="h-7 w-7 text-[var(--color-brand)]" />
            <span className="text-xl font-semibold tracking-tight">Sentinel</span>
          </div>

          {step === 'password' ? (
            <>
              <p className="mb-8 text-sm text-[var(--text-secondary)]">
                The unified registry for Gujarat's camera infrastructure.
              </p>

              {redirectMessage && (
                <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-status-online)]/30 bg-[var(--color-status-online-bg)] px-3 py-2 text-sm text-[var(--color-status-online)]">
                  {redirectMessage}
                </p>
              )}
              {error && (
                <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-status-unknown)]/40 bg-[var(--color-status-unknown-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
                  {error}
                </p>
              )}

              <form onSubmit={handleSubmitPassword} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting || isLocked}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                    Password
                  </label>
                  <div className={cn('relative', shake && 'animate-shake')}>
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isSubmitting || isLocked}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {rateLimitedSecondsLeft > 0 ? (
                  <p className="text-sm text-[var(--color-status-offline)]">{`(${rateLimitedSecondsLeft}s)`}</p>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  isLoading={isSubmitting && !isSuccess}
                  disabled={isLocked}
                >
                  {isSuccess ? '✓ Signed in' : 'Sign in'}
                </Button>
              </form>

              <p className="mt-6 text-center text-xs text-[var(--text-secondary)]">
                Trouble signing in? Contact your department administrator.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleBackToPassword}
                className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </button>

              <div className="mb-4 flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
                <Lock className="h-[17px] w-[17px]" />
              </div>

              <h1 className="text-2xl font-semibold tracking-tight text-balance">Enter your verification code</h1>
              <p className="mt-2 mb-6 text-[13.5px] text-[var(--text-secondary)] text-balance">
                Open your authenticator app and enter the 6-digit code for {email}.
              </p>

              <form onSubmit={handleSubmitCode}>
                <label htmlFor="totp-code" className="mb-2 block text-[12.5px] font-medium">
                  Verification code
                </label>
                <input
                  id="totp-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="482913"
                  autoComplete="one-time-code"
                  autoFocus
                  disabled={isSubmitting || isCodeRateLimited}
                  className={cn(
                    'h-[52px] w-full rounded-[var(--radius-md)] border bg-[var(--bg-surface)] px-4 text-center font-mono text-[22px] tracking-[0.22em] text-[var(--text-primary)] transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    codeError ? 'border-[var(--color-status-offline)]' : 'border-[var(--border-default)]',
                  )}
                />

                {codeError && !isCodeRateLimited && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-status-offline)]/40 bg-[var(--color-status-offline-bg)] px-3.5 py-2.5">
                    <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-[var(--color-status-offline)]" />
                    <p className="text-[12.5px]">{codeError}</p>
                  </div>
                )}
                {isCodeRateLimited && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-status-unknown)]/40 bg-[var(--color-status-unknown-bg)] px-3.5 py-2.5">
                    <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-[var(--color-status-unknown)]" />
                    <p className="text-[12.5px] text-balance">{codeError}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="mt-[18px] w-full"
                  isLoading={isSubmitting}
                  disabled={isCodeRateLimited || code.length === 0}
                >
                  Verify
                </Button>
              </form>

              <p className="mt-4 text-[12.5px] text-[var(--text-secondary)] text-balance">
                Lost your phone? You can also enter one of your backup codes here.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Right: live map backdrop — ~55%, hidden on mobile */}
      <div className="relative hidden flex-1 overflow-hidden md:block">
        <MapBackdrop />
      </div>
    </div>
  )
}
