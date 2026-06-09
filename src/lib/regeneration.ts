'use client'
/**
 * Global regeneration manager — curriculum "Regenerate with AI" and
 * "Generate Project Inspirations".
 *
 * The long-running generate requests live at MODULE scope, not inside page
 * components, so navigating away from the page no longer orphans the run:
 * the request keeps going, and when it finishes every data hook
 * (student-data, completion-stats, curriculum-overview) is refreshed no
 * matter which dashboard page is mounted. Pages subscribe via
 * useRegeneration() to render button/progress state.
 *
 * A sessionStorage flag mirrors the in-flight state so a full page reload
 * can resume showing progress: the original fetch dies with the old JS
 * context, but the server keeps generating — we poll the data hooks until
 * the deadline so results appear as soon as they land.
 */
import { useState, useEffect } from 'react'

export type RegenKind = 'curriculum' | 'inspirations'

export interface RegenState {
  running: boolean
  error: string | null
  /** Timestamp of the last successful completion (cleared on next start). */
  successAt: number | null
  /** Inspirations only: how many projects the last run created. */
  count: number
}

const TIMEOUTS_MS: Record<RegenKind, number> = {
  curriculum: 160_000, // matches the server's 150s budget + buffer
  inspirations: 120_000,
}

const state: Record<RegenKind, RegenState> = {
  curriculum: { running: false, error: null, successAt: null, count: 0 },
  inspirations: { running: false, error: null, successAt: null, count: 0 },
}

const listeners = new Set<() => void>()
function emit() { listeners.forEach(fn => fn()) }

const ssKey = (kind: RegenKind) => `regen-inflight-${kind}`

async function refreshAllData() {
  try {
    const [sd, cs, co] = await Promise.all([
      import('@/lib/student-data'),
      import('@/lib/completion-stats'),
      import('@/lib/curriculum-overview'),
    ])
    sd.refreshStudentData()
    cs.refreshCompletionStats()
    co.refreshCurriculumOverview()
  } catch { /* non-critical */ }
}

function finish(kind: RegenKind, patch: Partial<RegenState>) {
  state[kind] = { ...state[kind], running: false, ...patch }
  try { sessionStorage.removeItem(ssKey(kind)) } catch { /* SSR safe */ }
  emit()
}

export function startCurriculumRegeneration(): void {
  if (state.curriculum.running) return
  state.curriculum = { running: true, error: null, successAt: null, count: 0 }
  try { sessionStorage.setItem(ssKey('curriculum'), String(Date.now())) } catch { /* SSR safe */ }
  emit()

  void (async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS_MS.curriculum)
    try {
      const res = await fetch('/api/curriculum/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Route rebuilds the profile from DB; manual flag counts toward the limit
        body: JSON.stringify({ manual: true }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.status === 429) {
        const body = await res.json().catch(() => ({} as { error?: string }))
        finish('curriculum', { error: body.error || 'Regeneration limit reached. Use Start Over to reset.' })
        return
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        finish('curriculum', { error: `Generation failed (HTTP ${res.status}): ${body.slice(0, 150)}` })
        return
      }
      await refreshAllData()
      finish('curriculum', { successAt: Date.now() })
    } catch (err) {
      clearTimeout(timeoutId)
      // The server may still have completed the save — refresh so any new
      // plan shows up even though our request died.
      await refreshAllData()
      finish('curriculum', {
        error: err instanceof Error && err.name === 'AbortError'
          ? 'Generation timed out. The server may still finish — check back in a minute.'
          : 'Network error during generation. Try again in a moment.',
      })
    }
  })()
}

export function startInspirationsGeneration(): void {
  if (state.inspirations.running) return
  state.inspirations = { running: true, error: null, successAt: null, count: 0 }
  try { sessionStorage.setItem(ssKey('inspirations'), String(Date.now())) } catch { /* SSR safe */ }
  emit()

  void (async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS_MS.inspirations)
    try {
      const res = await fetch('/api/projects/generate-inspirations', {
        method: 'POST',
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      const body = await res.json().catch(() => ({} as { count?: number; error?: string }))
      if (!res.ok) {
        finish('inspirations', { error: body.error || `Generation failed (HTTP ${res.status})` })
        return
      }
      await refreshAllData()
      finish('inspirations', { successAt: Date.now(), count: body.count ?? 0 })
    } catch (err) {
      clearTimeout(timeoutId)
      await refreshAllData()
      finish('inspirations', {
        error: err instanceof Error && err.name === 'AbortError'
          ? 'Generation timed out. The server may still finish — refresh in a minute.'
          : 'Network error during generation. Try again in a moment.',
      })
    }
  })()
}

/**
 * After a full reload, the original request is gone but the server is still
 * generating. Resume the "running" indicator and poll the data hooks until
 * the deadline so the result appears the moment it lands.
 */
function resumeIfInflight(kind: RegenKind) {
  try {
    const startedAt = Number(sessionStorage.getItem(ssKey(kind)) || 0)
    if (!startedAt) return
    const remaining = TIMEOUTS_MS[kind] - (Date.now() - startedAt)
    if (remaining <= 0) {
      sessionStorage.removeItem(ssKey(kind))
      return
    }
    state[kind] = { running: true, error: null, successAt: null, count: 0 }
    const poll = setInterval(refreshAllData, 8_000)
    setTimeout(() => {
      clearInterval(poll)
      void refreshAllData()
      finish(kind, { successAt: Date.now() })
    }, remaining)
  } catch { /* SSR safe */ }
}

if (typeof window !== 'undefined') {
  resumeIfInflight('curriculum')
  resumeIfInflight('inspirations')
}

export function useRegeneration() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick(t => t + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return {
    curriculum: state.curriculum,
    inspirations: state.inspirations,
    startCurriculum: startCurriculumRegeneration,
    startInspirations: startInspirationsGeneration,
  }
}
