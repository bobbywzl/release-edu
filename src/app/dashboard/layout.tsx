'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar, BottomNav } from '@/components/sidebar'
import { XpToastProvider } from '@/components/xp-toast'
import { DailyCheckin } from '@/components/daily-checkin'
import { AccountSlotGate } from '@/components/account-slots'
import { TransitionScreen } from '@/components/transition-screen'
import { FeedbackButton } from '@/components/feedback-button'

// Shared transition flags — any code path that owns a redirect-prone window
// sets one of these so all guards stand down until the transition completes.
function isResetInProgress() {
  if (typeof window === 'undefined') return false
  try { return sessionStorage.getItem('curriculum-resetting') === '1' } catch { return false }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [resetActive, setResetActive] = useState(false)
  const isChrome = pathname === '/dashboard/portfolio/print'
  // The Workspace and the tree canvas are immersive, full-height experiences:
  // they manage their own panels and height, so we drop the shared mobile
  // chrome (top spacer, bottom nav, bottom padding) for those routes.
  const isChat = pathname === '/dashboard/workspace' || /^\/dashboard\/tree\/.+/.test(pathname)

  useEffect(() => {
    const sync = () => setResetActive(isResetInProgress())
    sync()
    const interval = setInterval(sync, 250)
    return () => clearInterval(interval)
  }, [])

  // Phones land on the mobile app. Dashboard HOME only — deep links
  // (workspace, canvas, settings) stay reachable — and "Desktop site"
  // inside /m sets the opt-out.
  useEffect(() => {
    if (pathname !== '/dashboard') return
    try {
      if (localStorage.getItem('tree-mobile-optout') === '1') return
      if (window.innerWidth <= 768 && window.matchMedia('(pointer: coarse)').matches) {
        window.location.replace('/m')
      }
    } catch { /* non-critical */ }
  }, [pathname])

  // The legacy Release EDU interview at /dashboard/onboarding is DELETED
  // (Aug 2026): it duplicated the tree stepper's questions across 6-10 chat
  // turns and collected fields no Tree EDU prompt reads. First-run users
  // plant their first tree through the one-screen session setup instead.

  // (The legacy curriculum auto-recovery effect is gone with the Tree pivot —
  // a user with no trees simply sees the Tree page's empty state.)

  if (resetActive) {
    return <TransitionScreen variant="reset" />
  }

  // Every path below fetches user data, so it renders behind the slot gate:
  // the tab binds its account slot FIRST, then the app (and its fetches)
  // mount with the right x-account-slot header from the very first request.
  if (isChrome) {
    return <AccountSlotGate>{children}</AccountSlotGate>
  }

  return (
    <AccountSlotGate>
      <div className="flex app-h overflow-hidden bg-background">
        <Sidebar />
        <main className={`relative flex-1 overflow-y-auto ${isChat ? '' : 'pb-16 lg:pb-0'}`}>
          {/* Branded backdrop for the standard pages — the immersive surfaces
              (workspace, canvas) own their own stage. Fixed inside the scroll
              container so the glow doesn't scroll away. */}
          {!isChat && (
            <>
              <div className="absolute inset-0 bg-canopy pointer-events-none" aria-hidden />
              <div className="absolute inset-0 bg-lattice pointer-events-none" aria-hidden />
            </>
          )}
          {/* Spacer clears the fixed mobile hamburger on normal pages. The chat
              handles that clearance itself (header padding), so skip it there. */}
          {!isChat && <div className="lg:hidden h-14" />}
          {/* Immersive pages (workspace, canvas) size themselves with h-full,
              so their wrapper must have a definite height — an auto-height div
              collapses the canvas to 0. Normal pages keep auto height so the
              main scroll area grows with content. */}
          <div className={isChat ? 'relative h-full' : 'relative'}>{children}</div>
        </main>
        {!isChat && <BottomNav />}
        <XpToastProvider />
        <DailyCheckin />
        {/* Ever-present feedback bubble — every dashboard surface, canvas
            and workspace included (route-aware placement inside). */}
        <FeedbackButton />
      </div>
    </AccountSlotGate>
  )
}
