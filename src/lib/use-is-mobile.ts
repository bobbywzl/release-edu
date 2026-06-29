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
// Safari < 14 only has the deprecated addListener/removeListener.
function onMql(m: MediaQueryList, cb: () => void): () => void {
  try { m.addEventListener('change', cb) }
  catch { try { (m as unknown as { addListener: (cb: () => void) => void }).addListener(cb) } catch { /* noop */ } }
  return () => {
    try { m.removeEventListener('change', cb) }
    catch { try { (m as unknown as { removeListener: (cb: () => void) => void }).removeListener(cb) } catch { /* noop */ } }
  }
}

export function useIsMobile(breakpointPx = 1024): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const widthMql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    // Touch tablets (iPad) in landscape report ≥1024px but still want the
    // single-column drawer layout rather than 3 cramped columns. Treat a
    // coarse-pointer device up to ~1366px as "mobile" for layout purposes.
    const tabletMql = window.matchMedia('(max-width: 1366px) and (pointer: coarse)')
    const update = () => setIsMobile(widthMql.matches || tabletMql.matches)
    update()
    const offWidth = onMql(widthMql, update)
    const offTablet = onMql(tabletMql, update)
    return () => { offWidth(); offTablet() }
  }, [breakpointPx])
  return isMobile
}
