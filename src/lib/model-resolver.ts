/**
 * Model resolver — Bob automatically adopts the newest model of each family.
 *
 * Queries the Anthropic /v1/models catalog and picks the most recently
 * released concrete id per family (claude-opus-*, claude-sonnet-*), so a new
 * Opus/Sonnet release upgrades Bob's teaching and judging WITHOUT a deploy.
 * Results are cached in-process for 6 hours; any failure falls back to the
 * pinned ids in CHAT_MODELS, so a catalog outage can never break chat.
 *
 * Deliberately NOT auto-resolved: the Haiku background tier
 * (pickBackgroundModel) — classification passes are tuned to a known-cheap
 * model and gain nothing from silent upgrades.
 */
import { CHAT_MODELS } from '@/lib/chat-model-router'

type Family = 'opus' | 'sonnet'

const PINNED: Record<Family, string> = {
  opus: CHAT_MODELS.opus,
  sonnet: CHAT_MODELS.sonnet,
}

const TTL_MS = 6 * 60 * 60 * 1000
// After a failed/timed-out catalog fetch, serve the fallback ids for this long
// before trying the network again — so a catalog outage can't add latency to
// EVERY model resolution (which would re-hit the slow endpoint on every call).
const FAIL_TTL_MS = 5 * 60 * 1000
// The catalog fetch is a best-effort optimization (pinned ids are always the
// fallback), so it must be strictly bounded — it may NEVER hang. Before this,
// an unbounded fetch to a slow/blocked catalog endpoint stalled the shared
// `inflight` promise and wedged EVERY model resolution (teaching AND judging)
// until the serverless instance recycled — surfacing as the workspace
// "trouble connecting" on essentially every checkpoint and chat turn.
const FETCH_TIMEOUT_MS = 4000
let cache: { at: number; ids: Record<Family, string>; ok: boolean } | null = null
let inflight: Promise<Record<Family, string>> | null = null

async function fetchLatest(): Promise<Record<Family, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ...PINNED }
  const ctrl = new AbortController()
  // The timer covers the WHOLE operation (connect + body read), and is always
  // cleared — so this call can never outlive FETCH_TIMEOUT_MS.
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`models catalog ${res.status}`)
    const body = (await res.json()) as { data?: Array<{ id?: string; created_at?: string }> }
    const rows = (body.data ?? []).filter(m => typeof m.id === 'string')

    const ids = { ...PINNED }
    for (const family of ['opus', 'sonnet'] as Family[]) {
      // Concrete versioned ids only (claude-opus-4-8, a future claude-opus-5…);
      // never aliases like -latest, so usage records stay exact.
      const re = new RegExp(`^claude-${family}-\\d`)
      const newest = rows
        .filter(m => re.test(m.id!) && !m.id!.includes('latest'))
        .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())[0]
      if (newest?.id) ids[family] = newest.id
    }
    return ids
  } finally {
    clearTimeout(timer)
  }
}

async function resolve(): Promise<Record<Family, string>> {
  // A successful cache lives 6h; a failed one is negative-cached for 5min so
  // an outage serves pinned ids INSTANTLY instead of re-hitting the slow
  // endpoint (bounded, but 4s × every call would still be a real regression).
  const ttl = cache?.ok ? TTL_MS : FAIL_TTL_MS
  if (cache && Date.now() - cache.at < ttl) return cache.ids
  if (!inflight) {
    inflight = fetchLatest()
      .then(ids => {
        cache = { at: Date.now(), ids, ok: true }
        return ids
      })
      .catch(() => {
        // Failed/timed-out refresh: serve the stale cache if we have one, else
        // the pinned ids — and negative-cache the choice so we don't re-hit the
        // endpoint on every call for the next FAIL_TTL_MS. Model resolution can
        // never hang or block the request; it degrades to a known-good id.
        const ids = cache?.ids ?? { ...PINNED }
        cache = { at: Date.now(), ids, ok: false }
        return ids
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Bob's teaching model (workspace chat, seeding, explainers). */
export async function getTeachingModel(): Promise<string> {
  return (await resolve()).opus
}

/** The structured/judging model (expansion proposals, checkpoint judging). */
export async function getJudgeModel(): Promise<string> {
  return (await resolve()).sonnet
}
