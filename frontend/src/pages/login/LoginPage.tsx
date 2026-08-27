import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, ShieldHalf } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { getApiErrorMessage, getApiErrorStatus } from '@/api/client'
import { cn } from '@/lib/utils'
import { MapBackdrop } from './MapBackdrop'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitedSecondsLeft, setRateLimitedSecondsLeft] = useState(0)
  const [shake, setShake] = useState(false)

  // Set by SettingsPage after a successful password change — a real
  // redirect-with-reason, not a silent bounce to the login screen.
  const redirectMessage = (location.state as { message?: string } | null)?.message ?? null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await login(email, password)
      setIsSuccess(true)
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      setTimeout(() => navigate(from, { replace: true }), 150)
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
          <p className="mb-8 text-sm text-[var(--text-secondary)]">
            The unified registry for Gujarat's camera infrastructure.
          </p>

          {redirectMessage && (
            <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-status-online)]/30 bg-[var(--color-status-online-bg)] px-3 py-2 text-sm text-[var(--color-status-online)]">
              {redirectMessage}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
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

            {error ? (
              <p className="text-sm text-[var(--color-status-offline)]">
                {error}
                {isLocked ? ` (${rateLimitedSecondsLeft}s)` : ''}
              </p>
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
        </div>
      </div>

      {/* Right: live map backdrop — ~55%, hidden on mobile */}
      <div className="relative hidden flex-1 overflow-hidden md:block">
        <MapBackdrop />
      </div>
    </div>
  )
}
