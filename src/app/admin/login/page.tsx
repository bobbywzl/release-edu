'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Shield, Loader2, Mail } from 'lucide-react'

function AdminLoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleEmail, setGoogleEmail] = useState<string | null | undefined>(undefined)

  // The admin gate has TWO factors: this password AND being signed in with an
  // authorized Google email. Surface the current Google account so the admin
  // knows whether the second factor is satisfied, and can switch accounts.
  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then(s => setGoogleEmail(s?.user?.email ?? null))
      .catch(() => setGoogleEmail(null))
  }, [])

  const emailError = searchParams.get('error') === 'email'

  useEffect(() => {
    if (searchParams.get('logout') === 'true') {
      // Clear admin auth cookie via API
      fetch('/api/admin/auth', { method: 'DELETE' }).then(() => {
        window.history.replaceState({}, '', '/admin/login')
      })
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.push('/admin')
      } else {
        const data = await res.json()
        setError(data.error || 'Invalid password')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-xl p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-lg font-bold text-foreground">Admin Access</h1>
            <p className="text-xs text-muted-foreground mt-1">Sign in with an authorized email, then enter the password</p>
          </div>

          {/* Factor 2 status: which Google account is signed in. */}
          <div className="mb-4 rounded-lg border border-border bg-background/60 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              {googleEmail === undefined ? (
                <span className="text-muted-foreground">Checking Google account…</span>
              ) : googleEmail ? (
                <span className="text-foreground truncate">{googleEmail}</span>
              ) : (
                <span className="text-amber-400">Not signed in with Google</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: '/admin/login' })}
              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground border border-border rounded-md py-1.5 transition-colors"
            >
              {googleEmail ? 'Use a different Google account' : 'Sign in with Google'}
            </button>
          </div>

          {emailError && (
            <div className="mb-4 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              This Google account isn’t an authorized admin. Sign in with an admin email above, then enter the password.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                autoFocus
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
      <AdminLoginContent />
    </Suspense>
  )
}
