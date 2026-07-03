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
  // The Workspace and the tree canvas are immersive, full-height experiences:
  // they manage their own panels and height, so we drop the shared mobile
  // chrome (top spacer, bottom nav, bottom padding) for those routes.
  const isChat = pathname === '/dashboard/workspace' || /^\/dashboard\/tree\/.+/.test(pathname)

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

  // (The legacy curriculum auto-recovery effect is gone with the Tree pivot —
  // a user with no trees simply sees the Tree page's empty state.)

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
    <div className="flex app-h overflow-hidden bg-background">
      <Sidebar />
      <main className={`flex-1 overflow-y-auto ${isChat ? '' : 'pb-16 lg:pb-0'}`}>
        {/* Spacer clears the fixed mobile hamburger on normal pages. The chat
            handles that clearance itself (header padding), so skip it there. */}
        {!isChat && <div className="lg:hidden h-14" />}
        {children}
      </main>
      {!isChat && <BottomNav />}
      <XpToastProvider />
    </div>
  )
}
