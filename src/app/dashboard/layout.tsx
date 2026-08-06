'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar, BottomNav } from '@/components/sidebar'
import { XpToastProvider } from '@/components/xp-toast'
import { DailyCheckin } from '@/components/daily-checkin'
import { AccountSlotGate } from '@/components/account-slots'
import { TransitionScreen } from '@/components/transition-screen'

// Shared transition flags — any code path that owns a redirect-prone window
// sets one of these so all guards stand down until the transition completes.
function isResetInProgress() {
  if (typeof window === 'undefined') return false
  try { return sessionStorage.getItem('curriculum-resetting') === '1' } catch { return false }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [resetActive, setResetActive] = useState(false)
  const isOnboardingFlow = pathname === '/dashboard/onboarding'
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

  // The legacy setup/onboarding redirect chain is GONE. It bounced users
  // into deleted Release EDU flows whenever the student-data fetch was slow
  // or transiently failed. New users simply see the dashboard's
  // plant-your-first-tree empty state; the Bob interview at
  // /dashboard/onboarding remains reachable but is never forced.

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

  if (isOnboardingFlow) {
    return <AccountSlotGate><div className="h-screen overflow-y-auto bg-background">{children}</div></AccountSlotGate>
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
          <div className="relative">{children}</div>
        </main>
        {!isChat && <BottomNav />}
        <XpToastProvider />
        <DailyCheckin />
      </div>
    </AccountSlotGate>
  )
}
