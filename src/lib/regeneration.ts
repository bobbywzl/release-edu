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

export type RegenKind = 'curriculum' | 'inspirations' | 'portfolio'

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
  portfolio: 320_000, // server marks the job stale after 5 min
}

const state: Record<RegenKind, RegenState> = {
  curriculum: { running: false, error: null, successAt: null, count: 0 },
  inspirations: { running: false, error: null, successAt: null, count: 0 },
  portfolio: { running: false, error: null, successAt: null, count: 0 },
}

const listeners = new Set<() => void>()
function emit() { listeners.forEach(fn => fn()) }

// This module is plain (no React context), so read the language preference
// straight from the i18n provider's localStorage cache. Error strings here
// are user-visible and must respect the student's chosen language.
const isZh = () => {
  try { return localStorage.getItem('language') === 'zh' } catch { return false }
}
const L = (en: string, zh: string) => (isZh() ? zh : en)

const ssKey = (kind: RegenKind) => `regen-inflight-${kind}`

async function refreshAllData() {
  try {
    const sd = await import('@/lib/student-data')
    sd.refreshStudentData()
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
        finish('curriculum', { error: body.error || L('Regeneration limit reached. Use Start Over to reset.', '已达到重新生成上限。使用"重新开始"来重置。') })
        return
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        finish('curriculum', { error: `${L('Generation failed', '生成失败')} (HTTP ${res.status}): ${body.slice(0, 150)}` })
        return
      }
      const body = await res.json().catch(() => null) as { aiGenerated?: boolean; aiError?: string | null } | null
      await refreshAllData()
      // The route returns 200 even when Claude failed (it guarantees a plan
      // exists), so check the aiGenerated flag: a failed run keeps the old
      // plan, doesn't burn a regeneration, and must read as an error.
      if (body && body.aiGenerated === false) {
        finish('curriculum', {
          error: L(
            'AI generation failed — your current curriculum was kept and no regeneration was used. Try again in a minute.',
            'AI 生成失败 —— 已保留当前课程，本次不计入重新生成次数。请稍后重试。',
          ) + (body.aiError ? ` [${body.aiError}]` : ''),
        })
        return
      }
      finish('curriculum', { successAt: Date.now() })
    } catch (err) {
      clearTimeout(timeoutId)
      // The server may still have completed the save — refresh so any new
      // plan shows up even though our request died.
      await refreshAllData()
      finish('curriculum', {
        error: err instanceof Error && err.name === 'AbortError'
          ? L('Generation timed out. The server may still finish — check back in a minute.', '生成超时。服务器可能仍在继续 —— 请一分钟后回来查看。')
          : L('Network error during generation. Try again in a moment.', '生成时网络出错。请稍后重试。'),
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
        finish('inspirations', { error: body.error || `${L('Generation failed', '生成失败')} (HTTP ${res.status})` })
        return
      }
      await refreshAllData()
      finish('inspirations', { successAt: Date.now(), count: body.count ?? 0 })
    } catch (err) {
      clearTimeout(timeoutId)
      await refreshAllData()
      finish('inspirations', {
        error: err instanceof Error && err.name === 'AbortError'
          ? L('Generation timed out. The server may still finish — refresh in a minute.', '生成超时。服务器可能仍在继续 —— 请一分钟后刷新。')
          : L('Network error during generation. Try again in a moment.', '生成时网络出错。请稍后重试。'),
      })
    }
  })()
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Poll the portfolio status endpoint until the server-side job reaches a
 * terminal state. The job itself runs on the server (status is DB-backed),
 * so this works no matter which page is mounted — or none.
 */
async function pollPortfolioUntilDone(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    await sleep(2_500)
    try {
      const res = await fetch('/api/portfolio/status', { cache: 'no-store' })
      if (!res.ok) continue // transient — keep polling
      const json = await res.json() as { status: string; error?: string }
      if (json.status === 'ready') {
        finish('portfolio', { successAt: Date.now() })
        return
      }
      if (json.status === 'error') {
        finish('portfolio', { error: json.error || L('Generation failed', '生成失败') })
        return
      }
      if (json.status === 'none') {
        // Nothing in flight server-side (e.g. job never started) — stop.
        finish('portfolio', { error: L('Generation did not start. Try again.', '生成未能启动。请重试。') })
        return
      }
    } catch { /* transient — keep polling */ }
  }
  finish('portfolio', { error: L('Generation timed out. Try again in a minute.', '生成超时。请一分钟后重试。') })
}

export function startPortfolioGeneration(): void {
  if (state.portfolio.running) return
  state.portfolio = { running: true, error: null, successAt: null, count: 0 }
  try { sessionStorage.setItem(ssKey('portfolio'), String(Date.now())) } catch { /* SSR safe */ }
  emit()

  void (async () => {
    try {
      const res = await fetch('/api/portfolio/generate', { method: 'POST' })
      const body = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        finish('portfolio', { error: body.error || `${L('Generation failed', '生成失败')} (HTTP ${res.status})` })
        return
      }
      await pollPortfolioUntilDone(Date.now() + TIMEOUTS_MS.portfolio)
    } catch {
      finish('portfolio', { error: L('Network error during generation. Try again in a moment.', '生成时网络出错。请稍后重试。') })
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
    if (kind === 'portfolio') {
      // Portfolio status is DB-backed — resume real polling.
      void pollPortfolioUntilDone(Date.now() + remaining)
      return
    }
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
  resumeIfInflight('portfolio')
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
    portfolio: state.portfolio,
    startCurriculum: startCurriculumRegeneration,
    startInspirations: startInspirationsGeneration,
    startPortfolio: startPortfolioGeneration,
  }
}
