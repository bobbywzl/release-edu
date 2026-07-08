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
let cache: { at: number; ids: Record<Family, string> } | null = null
let inflight: Promise<Record<Family, string>> | null = null

async function fetchLatest(): Promise<Record<Family, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ...PINNED }
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
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
}

async function resolve(): Promise<Record<Family, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids
  if (!inflight) {
    inflight = fetchLatest()
      .then(ids => {
        cache = { at: Date.now(), ids }
        return ids
      })
      .catch(() => {
        // Failed refresh: keep serving the stale cache if we have one,
        // otherwise the pinned ids. Retry on the next call.
        return cache?.ids ?? { ...PINNED }
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
