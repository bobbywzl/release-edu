'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar, BottomNav } from '@/components/sidebar'
import { XpToastProvider } from '@/components/xp-toast'
import { TransitionScreen } from '@/components/transition-screen'
import { useStudentData } from '@/lib/student-data'

// Shared transition flags — any code path that owns a redirect-prone window
// sets one of these so all guards stand down until the transition completes.
function isResetInProgress() {
  if (typeof window === 'undefined') return false
  try { return sessionStorage.getItem('curriculum-resetting') === '1' } catch { return false }
}
// The onboarding-completing flag stores a timestamp so it self-expires if a
// page is closed mid-transition and leaves the value behind.
const ONBOARDING_FLAG_MAX_AGE_MS = 60_000
function isOnboardingCompleting() {
  if (typeof window === 'undefined') return false
  try {
    const v = sessionStorage.getItem('onboarding-completing')
    if (!v) return false
    const ts = Number(v)
    if (!Number.isFinite(ts)) return v === '1'
    if (Date.now() - ts > ONBOARDING_FLAG_MAX_AGE_MS) {
      sessionStorage.removeItem('onboarding-completing')
      return false
    }
    return true
  } catch { return false }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: studentData, loading: studentLoading } = useStudentData()
  const [resetActive, setResetActive] = useState(false)
  const [onboardingTransition, setOnboardingTransition] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const recoveryAttempted = useRef(false)
  const isOnboardingPath = pathname === '/dashboard/onboarding'
  const isSetupPath = pathname === '/dashboard/setup'
  const isOnboardingFlow = isOnboardingPath || isSetupPath
  const isChrome = pathname === '/dashboard/portfolio/print'

  useEffect(() => {
    const sync = () => {
      setResetActive(isResetInProgress())
      setOnboardingTransition(isOnboardingCompleting())
    }
    sync()
    const interval = setInterval(sync, 250)
    return () => clearInterval(interval)
  }, [])

  // Single source of truth for onboarding-flow routing.
  // States:
  //   no setup → /dashboard/setup
  //   setup done, not onboarded → /dashboard/onboarding
  //   onboarded → /dashboard (out of setup/onboarding pages)
  // Transition flags suppress all redirects during a known in-flight window.
  useEffect(() => {
    if (resetActive || onboardingTransition || recovering) return
    if (isChrome) return
    if (studentLoading) return

    const { isOnboarded, hasSetupProfile } = studentData

    if (isOnboarded) {
      if (isOnboardingFlow) router.replace('/dashboard')
      return
    }

    // Not onboarded.
    if (!hasSetupProfile) {
      if (!isSetupPath) router.replace('/dashboard/setup')
      return
    }

    // Has setup, hasn't finished chat/curriculum.
    if (!isOnboardingPath) router.replace('/dashboard/onboarding')
  }, [
    resetActive, onboardingTransition, recovering, isChrome, studentLoading,
    studentData.isOnboarded, studentData.hasSetupProfile,
    isOnboardingFlow, isOnboardingPath, isSetupPath, router,
  ])

  // Early-exit: if curriculum data arrives mid-recovery (the server finished
  // saving and the cache refreshed), drop the transition screen immediately.
  useEffect(() => {
    if (recovering && studentData.hasCurriculum) setRecovering(false)
  }, [recovering, studentData.hasCurriculum])

  // Stuck-state auto-recovery. A user is `isOnboarded` but has no real
  // curriculum tracks — an earlier `/api/curriculum/generate` call crashed
  // or timed out before persisting the plan. Fires once per session on any
  // dashboard page so the user never sees the default-template flash.
  //
  // SAFETY: hard 12s timeout + periodic poll for `hasCurriculum`. We never
  // hold the loading screen waiting on a slow/hung server. If the user really
  // has no curriculum after the timeout, the dashboard's empty-state UI
  // handles it and they can manually retry via Bob.
  useEffect(() => {
    if (recoveryAttempted.current) return
    if (isChrome || isOnboardingFlow) return
    if (studentLoading) return
    if (resetActive || onboardingTransition) return
    if (!studentData.isOnboarded) return
    if (studentData.hasCurriculum) return

    recoveryAttempted.current = true
    setRecovering(true)
    try { sessionStorage.setItem('onboarding-completing', String(Date.now())) } catch { /* SSR safe */ }

    const HARD_TIMEOUT_MS = 12_000
    const POLL_INTERVAL_MS = 1500
    let cancelled = false

    const exit = () => {
      if (cancelled) return
      cancelled = true
      try { sessionStorage.removeItem('onboarding-completing') } catch { /* SSR safe */ }
      setRecovering(false)
    }

    // Fire the regeneration request without blocking the UI. We don't await
    // it — the poll below will detect when tracks land in the DB.
    void (async () => {
      try {
        await fetch('/api/curriculum/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      } catch (err) {
        console.error('[Layout recovery] curriculum generation failed:', err)
      }
      // Whether the call succeeded, errored, or hung past the timeout, force
      // a fresh fetch so the empty-state UI gets accurate data on exit.
      try {
        const [sd, cs, co] = await Promise.all([
          import('@/lib/student-data'),
          import('@/lib/completion-stats'),
          import('@/lib/curriculum-overview'),
        ])
        sd.refreshStudentData()
        cs.refreshCompletionStats()
        co.refreshCurriculumOverview()
      } catch { /* non-fatal */ }
    })()

    // Poll for curriculum existence. Exits as soon as the server-side save
    // lands AND the client cache picks it up.
    const pollId = setInterval(() => {
      if (cancelled) return clearInterval(pollId)
      void import('@/lib/student-data').then(m => m.refreshStudentData()).catch(() => {})
    }, POLL_INTERVAL_MS)

    // Hard timeout — never strand the user on the loading screen.
    const timeoutId = setTimeout(() => {
      console.warn('[Layout recovery] timeout — exiting transition screen and showing dashboard')
      clearInterval(pollId)
      exit()
    }, HARD_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearInterval(pollId)
      clearTimeout(timeoutId)
    }
  }, [
    isChrome, isOnboardingFlow, studentLoading, resetActive, onboardingTransition,
    studentData.isOnboarded, studentData.hasCurriculum,
  ])

  if (isChrome) {
    return <>{children}</>
  }

  if (resetActive || recovering) {
    return <TransitionScreen variant={resetActive ? 'reset' : 'default'} />
  }

  if (isOnboardingFlow) {
    return <div className="h-screen overflow-y-auto bg-background">{children}</div>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto pb-16 lg:pb-0 pl-0 lg:pl-0">
        <div className="lg:hidden h-14" />
        {children}
      </main>
      <BottomNav />
      <XpToastProvider />
    </div>
  )
}
