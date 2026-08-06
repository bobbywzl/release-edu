'use client'
import { signIn } from 'next-auth/react'
import { motion } from 'framer-motion'
import { TreeLogo } from '@/components/tree-logo'
import { ArrowRight, Sparkles, MessageSquare, Hammer, BookOpen, Award } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Vercel preview context, inlined at build (see next.config.mjs). On a
// preview, Google sign-in only works after this branch's callback URL is
// added to the Google OAuth client — surface the exact string to copy.
const IS_PREVIEW = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
const PREVIEW_CALLBACK = process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL
  ? `https://${process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL}/api/auth/callback/google`
  : ''

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

// The showcase tree — a real, hand-picked example rendered before anything is
// asked of the visitor (static content, no user data, no demo accounts).
function ShowcaseTree() {
  return (
    <div className="relative h-52 select-none" aria-hidden>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 360 208" fill="none">
        <path d="M180 190 C 150 156, 110 136, 92 94" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" opacity="0.6" />
        <path d="M180 190 C 210 152, 246 138, 262 96" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" opacity="0.6" />
        <path d="M92 94 C 84 64, 66 52, 58 30" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        <path d="M92 94 C 104 66, 122 54, 134 34" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        <path d="M262 96 C 272 68, 288 56, 298 34" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      </svg>
      {[
        { x: '50%', y: 190, label: 'Sweet backyard strawberries', dot: 'w-5 h-5 bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.55)]', done: false },
        { x: '25%', y: 94, label: 'The plant itself', dot: 'w-4 h-4 bg-emerald-500 border-2 border-emerald-300/70', done: true },
        { x: '73%', y: 96, label: 'Soil, water & nutrients', dot: 'w-4 h-4 bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.55)] animate-pulse', done: false },
        { x: '16%', y: 30, label: 'Genes set the ceiling', dot: 'w-3 h-3 bg-emerald-500 border-2 border-emerald-300/70', done: true },
        { x: '37%', y: 34, label: 'June- vs everbearing', dot: 'w-3 h-3 bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.55)] animate-pulse', done: false },
        { x: '83%', y: 34, label: 'N-P-K: the big three', dot: 'w-3 h-3 bg-teal-300 shadow-[0_0_10px_rgba(94,234,212,0.55)] animate-pulse', done: false },
      ].map(n => (
        <div key={n.label} className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: n.x, top: n.y - 8 }}>
          <span className={`rounded-full ${n.dot}`} />
          <span className={`mt-1.5 text-[10px] leading-tight text-center max-w-[96px] ${n.done ? 'text-emerald-300' : 'text-muted-foreground'}`}>
            {n.label}{n.done ? ' ✓' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [signUpLoading, setSignUpLoading] = useState(false)
  const [signInLoading, setSignInLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [copiedCallback, setCopiedCallback] = useState(false)

  // If the user already has a valid session, never strand them on /login —
  // forward them into the app. Without this, anything that lands an
  // authenticated user back on /login (a stray redirect, the back button, a
  // re-auth round-trip) leaves them stuck here, and clicking sign-in just
  // re-opens Google's account chooser — the "jumping around / back to login".
  useEffect(() => {
    let cancelled = false
    // "Switch account" entry point: an explicit /login?switch=1 visit must
    // SHOW the form even with a live session — the whole point is adding a
    // different account for THIS tab (per-tab account slots).
    try {
      if (new URLSearchParams(window.location.search).has('switch')) {
        setCheckingSession(false)
        return () => { cancelled = true }
      }
    } catch { /* SSR-safe: effect only runs client-side anyway */ }
    fetch('/api/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (cancelled) return
        if (s && s.user) router.replace('/dashboard')
        else setCheckingSession(false)
      })
      .catch(() => { if (!cancelled) setCheckingSession(false) })
    return () => { cancelled = true }
  }, [router])

  const handleSignUp = async () => {
    setSignUpLoading(true)
    // This tab is choosing a (possibly new) account — drop its old slot
    // binding so it adopts whoever completes the OAuth flow.
    try { sessionStorage.removeItem('tree-account-slot') } catch { /* private mode */ }
    // Always go to /dashboard — it checks isOnboarded and routes accordingly
    await signIn('google', { callbackUrl: '/dashboard' })
  }

  const handleSignIn = async () => {
    setSignInLoading(true)
    try { sessionStorage.removeItem('tree-account-slot') } catch { /* private mode */ }
    await signIn('google', { callbackUrl: '/dashboard' })
  }

  // Brief gate while we check for an existing session, so authenticated users
  // are forwarded to the dashboard without the login form flashing first.
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* Backdrop: canopy glow + dot lattice, behind everything */}
      <div className="absolute inset-0 bg-canopy pointer-events-none" />
      <div className="absolute inset-0 bg-lattice pointer-events-none" />

      {/* Top nav */}
      <header className="relative z-10 max-w-6xl w-full mx-auto px-6 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <TreeLogo className="w-5 h-5 text-primary" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">Tree EDU</span>
        </div>
        <button
          onClick={handleSignIn}
          disabled={signUpLoading || signInLoading}
          className="text-sm font-medium text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg border border-transparent hover:border-white/10 hover:bg-white/[0.04] transition-all"
        >
          {signInLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-6 pt-14 pb-16 lg:pt-20">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-16 items-center">

          {/* Left — the pitch + CTA */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/25 bg-primary/[0.07] text-xs font-medium text-emerald-300 mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              AI-verified mastery — no self-marking
            </div>

            <h1 className="font-display text-[2.6rem] leading-[1.08] sm:text-5xl lg:text-[3.4rem] font-semibold text-foreground text-balance">
              Bring one problem.
              <br />
              Leave with <em className="text-primary not-italic font-display italic">the whole tree.</em>
            </h1>

            <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl">
              Tree EDU turns a single question — <span className="text-foreground">your</span> question — into a
              living map of everything it takes to truly master it. Taught one-on-one by Bob, your AI mentor.
              Proven branch by branch through checkpoints.
            </p>

            {/* Preview-deployment notice: Google OAuth needs this branch's
                callback authorized once. */}
            {IS_PREVIEW && (
              <div className="mt-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 space-y-2 max-w-xl">
                <p className="text-xs font-semibold text-amber-300">Preview deployment</p>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Google sign-in works here only after this branch&apos;s callback URL is added once to the
                  Google OAuth client (Google Cloud Console → Credentials → Authorized redirect URIs).
                </p>
                {PREVIEW_CALLBACK && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(PREVIEW_CALLBACK).catch(() => {})
                      setCopiedCallback(true)
                      setTimeout(() => setCopiedCallback(false), 2000)
                    }}
                    className="w-full text-left text-[10px] font-mono text-amber-100/90 bg-black/30 border border-amber-400/30 rounded-lg px-2.5 py-2 hover:bg-black/40 transition-colors break-all"
                    title="Copy callback URL"
                  >
                    {PREVIEW_CALLBACK}
                    <span className="block mt-1 font-sans text-amber-300/80">{copiedCallback ? 'Copied ✓' : 'Tap to copy'}</span>
                  </button>
                )}
              </div>
            )}

            {/* CTA */}
            <div className="mt-8 max-w-xl">
              <div className="rounded-2xl border border-primary/30 bg-white/[0.03] backdrop-blur-sm p-5 shadow-[0_0_50px_-18px_hsl(var(--primary)/0.5)]">
                <div className="flex items-center gap-2 mb-3.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">New here? Plant your first tree</span>
                </div>
                <button
                  onClick={handleSignUp}
                  disabled={signUpLoading || signInLoading}
                  className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2.5 hover:brightness-110 active:scale-[0.99] transition-all shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.7)] disabled:opacity-60"
                >
                  {signUpLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Setting up…
                    </>
                  ) : (
                    <>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center"><GoogleMark className="w-3.5 h-3.5" /></span>
                      Sign up with Google
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
                <p className="mt-3 text-[11px] text-muted-foreground text-center">
                  One Google account — no forms, no passwords.{' '}
                  <button onClick={handleSignIn} disabled={signUpLoading || signInLoading} className="text-foreground/80 underline underline-offset-2 hover:text-primary transition-colors">
                    Already growing? Sign in
                  </button>
                </p>
              </div>
            </div>
          </motion.div>

          {/* Right — the showcase: a real tree, shown before anything is asked */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="rounded-3xl p-px bg-gradient-to-b from-white/[0.14] via-white/[0.05] to-transparent">
              <div className="rounded-[calc(1.5rem-1px)] border border-transparent bg-card/90 backdrop-blur-xl p-5 sm:p-6">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1">
                  <TreeLogo className="w-3.5 h-3.5 text-primary" /> A real tree, grown from one question
                </p>
                <ShowcaseTree />
                <div className="rounded-xl border border-white/[0.07] bg-background/60 px-3.5 py-2.5 mt-2">
                  <p className="text-[10px] font-semibold text-foreground mb-0.5">From this tree&apos;s workspace — &ldquo;Genes set the ceiling&rdquo;</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Sweetness has a genetic ceiling: the variety fixes the potential sugar (Brix), and growing
                    conditions decide how close you get. That&apos;s why picking the cultivar comes before any fertilizer…
                  </p>
                </div>
                <p className="mt-2.5 text-[10px] text-muted-foreground leading-relaxed">
                  Solid green = <span className="text-emerald-300">verified through checkpoints</span> · glowing buds are still
                  growing. Your tree starts with your problem.
                </p>
              </div>
            </div>
            {/* Floating verification chip — the product's core moment */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.55 }}
              className="absolute -top-3.5 -right-2 sm:-right-4 rotate-2 rounded-xl border border-emerald-400/40 bg-emerald-500/15 backdrop-blur px-3 py-1.5 text-[11px] font-semibold text-emerald-300 shadow-lg"
            >
              ✓ Node verified · +40 XP
            </motion.div>
          </motion.div>
        </div>

        {/* Value props */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 lg:mt-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
        >
          {[
            { icon: BookOpen, label: 'One problem → a whole tree', sub: 'It grows only from your questions — never ahead of your curiosity.' },
            { icon: MessageSquare, label: '1-on-1 AI mentor', sub: 'Bob teaches every branch you open, at exactly your depth.' },
            { icon: Hammer, label: 'Mastery you prove', sub: 'AI-verified checkpoints on every node — no self-marking.' },
            { icon: Award, label: 'A record that proves it', sub: 'Every verified node, on the record, in your portfolio.' },
          ].map(f => (
            <div key={f.label} className="surface surface-hover p-5">
              <div className="w-9 h-9 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center mb-3">
                <f.icon className="w-[18px] h-[18px] text-primary" />
              </div>
              <p className="text-sm font-bold text-foreground leading-snug">{f.label}</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{f.sub}</p>
            </div>
          ))}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><TreeLogo className="w-3.5 h-3.5 text-primary/70" /> Tree EDU</span>
          <span>Rooted in one problem · grown by your questions · proven by checkpoints</span>
        </div>
      </footer>
    </div>
  )
}
