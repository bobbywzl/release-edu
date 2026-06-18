'use client'
import { useEffect, useState } from 'react'

/**
 * SSR-safe viewport check. Returns true below the given breakpoint (default
 * 1024px — Tailwind's `lg`). Used to switch the Bob chat's side panels between
 * inline columns (desktop) and slide-in overlay drawers (mobile).
 *
 * Defaults to false on the server / first paint to match the desktop-first
 * markup, then corrects on mount. Pair with effect-driven defaults (e.g.
 * collapse panels on mobile) rather than relying on this during render of
 * critical first-paint content.
 */
export function useIsMobile(breakpointPx = 1024): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [breakpointPx])
  return isMobile
}
