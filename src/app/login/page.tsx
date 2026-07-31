'use client'
import { signIn } from 'next-auth/react'
import { motion } from 'framer-motion'
import { TreeLogo } from '@/components/tree-logo'
import { Zap, ArrowRight, Sparkles, MessageSquare, Hammer, Brain, Target, BookOpen, Award } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Combined logo for the "Learn while doing" pillar: project-based learning
// (the hammer/build badge) fused with chat-based learning (the speech bubble).
function ProjectChatIcon({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex ${className ?? ''}`}>
      <MessageSquare className="w-full h-full" />
      <Hammer className="absolute -bottom-1 -right-1.5 w-[62%] h-[62%]" strokeWidth={2.75} />
    </span>
  )
}

// Vercel preview context, inlined at build (see next.config.mjs). On a
// preview, Google sign-in only works after this branch's callback URL is
// added to the Google OAuth client — surface the exact string to copy.
const IS_PREVIEW = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'
const PREVIEW_CALLBACK = process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL
  ? `https://${process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL}/api/auth/callback/google`
  : ''

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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Main content — centered */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-10">

          {/* Logo + tagline */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-xl bg-foreground flex items-center justify-center">
                <TreeLogo className="w-6 h-6 text-background" />
              </div>
              <span className="text-2xl font-bold text-foreground">Tree EDU</span>
            </div>
            <h1 className="text-3xl font-bold text-foreground leading-tight">
              Learn <span className="text-muted-foreground">the world.</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-3">
              <span className="text-foreground font-semibold">Bring one specific problem</span> — grow a tree of understanding around it.
            </p>
          </motion.div>


          {/* Preview-deployment notice: Google OAuth needs this branch's
              callback authorized once. */}
          {IS_PREVIEW && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 space-y-2"
            >
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
            </motion.div>
          )}

          {/* Sign Up — Primary CTA, FIRST block on the page */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="space-y-4"
          >
            <div className="p-6 rounded-xl border-2 border-primary/50 bg-card space-y-4 shadow-[0_0_38px_-14px_hsl(var(--primary)/0.55)]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-foreground" />
                <span className="text-sm font-semibold text-foreground">New here? Start your journey</span>
              </div>

              <Button
                onClick={handleSignUp}
                disabled={signUpLoading || signInLoading}
                className="w-full h-12 text-sm font-semibold bg-foreground text-background hover:bg-foreground/90"
                size="lg"
              >
                {signUpLoading ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Setting up...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Sign up with Google
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>

              <p className="text-[10px] text-muted-foreground text-center">
                We&apos;ll connect to Google Drive to save your project files & assignments
              </p>
            </div>
          </motion.div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs text-muted-foreground">
              <span className="bg-background px-4">already have an account?</span>
            </div>
          </div>

          {/* Sign In — Secondary */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Button
              variant="outline"
              onClick={handleSignIn}
              disabled={signUpLoading || signInLoading}
              className="w-full h-10 text-sm font-medium"
            >
              {signInLoading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                'Sign in with Google'
              )}
            </Button>
          </motion.div>

          {/* Value props — what the product is, right under the CTA */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
                <BookOpen className="w-5 h-5 text-foreground" />
                <p className="text-base font-bold text-foreground leading-snug">One problem → a whole tree</p>
                <p className="text-xs text-muted-foreground">It grows from your questions</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
                <MessageSquare className="w-5 h-5 text-foreground" />
                <p className="text-base font-bold text-foreground leading-snug">1-on-1 AI mentor</p>
                <p className="text-xs text-muted-foreground">Bob teaches every branch you open</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
                <Hammer className="w-5 h-5 text-foreground" />
                <p className="text-base font-bold text-foreground leading-snug">Mastery you prove</p>
                <p className="text-xs text-muted-foreground">AI-verified checkpoints — no self-marking</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
                <Award className="w-5 h-5 text-foreground" />
                <p className="text-base font-bold text-foreground leading-snug">A résumé that proves it</p>
                <p className="text-xs text-muted-foreground">Every verified node on record</p>
              </div>
            </div>
          </motion.div>

          {/* RECIPROCITY: a real tree shown BEFORE anything is asked — a
              hand-picked, read-only showcase (static content, no user data,
              no demo accounts). Visitors receive real teaching first. */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-xl border border-border bg-card p-4 space-y-3"
          >
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <TreeLogo className="w-3.5 h-3.5 text-emerald-400" /> A real tree, grown from one question
            </p>
            {/* Static mini-tree: root question at the bottom, branches up.
                Solid emerald = verified through checkpoints; glowing = still
                growing. Pure SVG/CSS — nothing fetched. */}
            <div className="relative h-44 select-none" aria-hidden>
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 360 176" fill="none">
                <path d="M180 158 C 150 128, 110 112, 92 78" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
                <path d="M180 158 C 210 126, 246 114, 262 80" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
                <path d="M92 78 C 84 54, 66 44, 58 26" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
                <path d="M92 78 C 104 56, 122 46, 134 30" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
                <path d="M262 80 C 272 58, 288 48, 298 30" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
              </svg>
              {[
                { x: '50%', y: 158, label: 'Sweet backyard strawberries', dot: 'w-5 h-5 bg-primary shadow-[0_0_14px_hsl(var(--primary)/0.5)]', done: false },
                { x: '25%', y: 78, label: 'The plant itself', dot: 'w-4 h-4 bg-emerald-500 border-2 border-emerald-300/70', done: true },
                { x: '73%', y: 80, label: 'Soil, water & nutrients', dot: 'w-4 h-4 bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.5)] animate-pulse', done: false },
                { x: '16%', y: 26, label: 'Genes set the ceiling', dot: 'w-3 h-3 bg-emerald-500 border-2 border-emerald-300/70', done: true },
                { x: '37%', y: 30, label: 'June- vs everbearing', dot: 'w-3 h-3 bg-sky-400 shadow-[0_0_9px_rgba(56,189,248,0.5)] animate-pulse', done: false },
                { x: '83%', y: 30, label: 'N-P-K: the big three', dot: 'w-3 h-3 bg-teal-300 shadow-[0_0_9px_rgba(94,234,212,0.5)] animate-pulse', done: false },
              ].map(n => (
                <div key={n.label} className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: n.x, top: n.y - 8 }}>
                  <span className={`rounded-full ${n.dot}`} />
                  <span className={`mt-1 text-[9px] leading-tight text-center max-w-[90px] ${n.done ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                    {n.label}{n.done ? ' ✓' : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2">
              <p className="text-[10px] font-semibold text-foreground mb-0.5">From this tree&apos;s workspace — &ldquo;Genes set the ceiling&rdquo;</p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Sweetness has a genetic ceiling: the variety fixes the potential sugar (Brix), and growing
                conditions decide how close you get. That&apos;s why picking the cultivar comes before any fertilizer…
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Solid green = understanding <span className="text-emerald-300">verified through checkpoints</span> — glowing buds are still growing. Your tree starts with your problem.
            </p>
          </motion.div>

          {/* Features grid */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="grid grid-cols-3 gap-3 pt-2"
          >
            {[
              { icon: Brain, label: 'AI Mentor', sub: 'Builds your path' },
              { icon: ProjectChatIcon, label: 'Learn while doing', sub: 'Projects & chat' },
              { icon: Target, label: 'Personalized', sub: 'Fitted to you' },
            ].map((f, i) => (
              <div key={i} className="text-center space-y-1">
                <f.icon className="w-4 h-4 mx-auto text-muted-foreground" />
                <p className="text-[11px] font-medium text-foreground">{f.label}</p>
                <p className="text-[10px] text-muted-foreground">{f.sub}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 text-[10px] text-muted-foreground">
        80% project-based · 20% curriculum · 100% personalized
      </div>
    </div>
  )
}
