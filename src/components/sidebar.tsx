'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Bot,
  Settings, Zap, ChevronRight,
  Menu, X, ChevronLeft, LogOut, Award, Pin, PinOff, Sprout,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TreeLogo } from '@/components/tree-logo'
import { useStudentData } from '@/lib/student-data'
import { useT } from '@/lib/i18n'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, key: 'nav.dashboard' },
  { href: '/dashboard/tree', icon: Sprout, key: 'nav.tree' },
  { href: '/dashboard/workspace', icon: Bot, key: 'nav.workspace' },
  { href: '/dashboard/portfolio', icon: Award, key: 'nav.portfolio' },
  { href: '/dashboard/settings', icon: Settings, key: 'nav.settings' },
]

const PINNED_KEY = 'sidebar_pinned'

export function Sidebar() {
  const pathname = usePathname()
  const t = useT()
  // The chat is immersive on mobile (no bottom nav), so the hamburger is its
  // only nav affordance there. Everywhere else the bottom nav handles it, so
  // the hamburger is hidden to reduce clutter.
  const isChat = pathname === '/dashboard/workspace' || /^\/dashboard\/tree\/.+/.test(pathname)
  const [pinned, setPinned] = useState(false) // permanently expanded
  const [hovered, setHovered] = useState(false) // expanded on hover
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data: { student: mockStudent } } = useStudentData()
  const initial = (mockStudent.name && mockStudent.name.trim()[0]?.toUpperCase()) || '·'
  const displayName = mockStudent.name?.trim() || ''
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  useEffect(() => {
    setIsDemo(document.cookie.includes('demo-mode=true'))
  }, [])

  const expanded = pinned || hovered

  // Persist pin state. On touch devices (iPad/tablet) there is no hover, so the
  // hover-to-expand sidebar would be stuck collapsed and unusable — default it
  // to expanded there unless the user has explicitly set a preference.
  useEffect(() => {
    const stored = localStorage.getItem(PINNED_KEY)
    if (stored === 'true') { setPinned(true); return }
    if (stored === 'false') return
    try {
      // Not on the chat route — there the 3 columns need every pixel.
      if (!isChat && window.matchMedia?.('(pointer: coarse)')?.matches) setPinned(true)
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function togglePin() {
    const next = !pinned
    setPinned(next)
    localStorage.setItem(PINNED_KEY, String(next))
  }

  function handleMouseEnter() {
    if (pinned) return
    hoverTimeout.current = setTimeout(() => setHovered(true), 80)
  }

  function handleMouseLeave() {
    if (pinned) return
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    setHovered(false)
  }

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      {/* Mobile hamburger — only on the chat route (its sole nav affordance);
          other pages use the bottom nav, so it's hidden there. */}
      {isChat && (
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden fixed top-3 left-3 z-50 w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center shadow-md touch-manipulation active:scale-95 active:bg-accent transition-transform"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-foreground" />
        </button>
      )}

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: expanded ? 256 : 56 }}
        transition={{ duration: 0.18, ease: 'easeInOut' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="hidden lg:flex h-full flex-col border-r border-border bg-card overflow-hidden flex-shrink-0 relative z-30"
      >
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center px-3 gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <TreeLogo className="w-4.5 h-4.5 text-primary-foreground" />
          </div>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 min-w-0 overflow-hidden"
              >
                <div className="font-bold text-foreground text-sm whitespace-nowrap">{t("nav.appName")}</div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{t("nav.appTagline")}</div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Pin toggle — only visible when expanded */}
          <AnimatePresence>
            {expanded && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={togglePin}
                title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
                className="w-6 h-6 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-auto"
              >
                {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} title={!expanded ? t(item.key) : undefined}>
                <motion.div
                  whileHover={{ x: expanded ? 2 : 0 }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors',
                    expanded ? 'px-3 py-2.5' : 'px-2 py-2.5 justify-center',
                    isActive
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <AnimatePresence mode="wait">
                    {expanded && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.12 }}
                        className="flex-1 whitespace-nowrap overflow-hidden"
                      >
                        {t(item.key)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {expanded && isActive && <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" />}
                </motion.div>
              </Link>
            )
          })}
        </nav>

        {/* Student info bottom */}
        <div className={cn('border-t border-border', expanded ? 'p-4' : 'p-3')}>
          {!expanded ? (
            <div className="flex flex-col items-center gap-2">
              <Link href="/dashboard/settings" title={t("nav.settings")}>
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs hover:ring-2 hover:ring-primary/30 transition-all cursor-pointer">
                  {initial}
                </div>
              </Link>
              <button
                onClick={() => { isDemo ? (window.location.href = '/api/demo/clear') : import('next-auth/react').then(m => m.signOut({ callbackUrl: '/login' })) }}
                className="w-7 h-7 rounded-md hover:bg-destructive/20 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                title={t("nav.logout")}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Link href="/dashboard/settings" className="flex items-center gap-3 hover:bg-accent/50 rounded-lg p-1 -m-1 transition-colors cursor-pointer">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{displayName || ' '}</div>
                  <div className="text-xs text-muted-foreground">{t("common.level")} {mockStudent.level}</div>
                </div>
              </Link>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { isDemo ? (window.location.href = '/api/demo/clear') : import('next-auth/react').then(m => m.signOut({ callbackUrl: '/login' })) }}
                  className="flex-1 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-2 py-1.5 transition-colors"
                  title={t("nav.logout")}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t("nav.logout")}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="lg:hidden fixed left-0 top-0 h-screen w-64 bg-card border-r border-border z-50 flex flex-col overflow-hidden"
          >
            <div className="h-14 border-b border-border flex items-center px-4 justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <TreeLogo className="w-4.5 h-4.5 text-primary-foreground" />
                </div>
                <div className="font-bold text-foreground text-sm">{t("nav.appName")}</div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                return (
                  <Link key={item.href} href={item.href}>
                    <div className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}>
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {t(item.key)}
                      {isActive && <ChevronRight className="w-3 h-3 ml-auto" />}
                    </div>
                  </Link>
                )
              })}
            </nav>
            <div className="border-t border-border p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                  {initial}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{displayName || ' '}</div>
                  <div className="text-xs text-muted-foreground">{t("common.level")} {mockStudent.level}</div>
                </div>
              </div>
              <button
                onClick={() => { isDemo ? (window.location.href = '/api/demo/clear') : import('next-auth/react').then(m => m.signOut({ callbackUrl: '/login' })) }}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> {t("nav.logout")}
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const t = useT()
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-40 flex select-none touch-manipulation"
      // Lift above the iOS home indicator / Safari toolbar so the buttons
      // aren't partially covered (which made them feel unresponsive).
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {navItems.slice(0, 5).map(item => {
        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              // Full-cell tap target (≥56px tall), with an explicit active state
              // so taps register visually on touch.
              'flex-1 flex flex-col items-center justify-center gap-1 min-h-[3.5rem] py-2 text-[10px] font-medium touch-manipulation transition-colors active:bg-accent',
              isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground'
            )}
          >
            <item.icon className="w-5 h-5" />
            {t(item.key).split(' ')[0]}
          </Link>
        )
      })}
    </nav>
  )
}
