/**
 * AI usage telemetry — one tiny helper used by every model call site to record
 * token usage + computed cost into the UsageEvent table. Powers the admin cost
 * dashboard. All writes are fire-and-forget and fully guarded: recording usage
 * must NEVER break or slow the user-facing response.
 */
import prisma from '@/lib/prisma'

export type UsageFeature =
  // ── Tree EDU features ──
  | 'tree-seed' | 'tree-expand' | 'tree-explainer' | 'tree-verify' | 'tree-digest' | 'node-chat'
  | 'tree-copilot' | 'tree-summary'
  | 'onboarding' | 'reflection' | 'insight' | 'title' | 'portfolio' | 'image' | 'other'
  // ── Legacy (pre-pivot data still in the telemetry table) ──
  | 'tutoring' | 'research' | 'curriculum' | 'chapter' | 'quiz' | 'capstone' | 'compaction' | 'project'

export type UsageProvider = 'anthropic' | 'google'

// Per-1M-token pricing in USD. Anthropic publishes cache-write at 1.25× input
// and cache-read at 0.1× input. Gemini figures are approximate for preview
// models and have no cache tier. Update here when prices change — it's the one
// source of truth for cost math.
interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

export const MODEL_PRICING: Record<string, Price> = {
  // Anthropic
  'claude-opus-4-8':            { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4-7':            { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-5':            { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-6':          { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75 }, // legacy — keep for historical usage records
  'claude-haiku-4-5-20251001':  { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  // Google Gemini (approximate)
  'gemini-3.1-pro-preview':     { input: 1.25, output: 5,   cacheRead: 0.3125, cacheWrite: 1.25 },
  'gemini-3-flash-preview':     { input: 0.1,  output: 0.4, cacheRead: 0.025,  cacheWrite: 0.1 },
}

// Conservative fallback for an unrecognised model (Sonnet-tier) so unknown
// spend is still counted rather than dropped to $0.
const FALLBACK_PRICE: Price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

export function priceFor(model: string): Price {
  return MODEL_PRICING[model] ?? FALLBACK_PRICE
}

export interface TokenCounts {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export function computeCostUsd(model: string, t: TokenCounts): number {
  const p = priceFor(model)
  const input = t.inputTokens ?? 0
  const output = t.outputTokens ?? 0
  const cacheRead = t.cacheReadTokens ?? 0
  const cacheWrite = t.cacheWriteTokens ?? 0
  const cost =
    (input / 1_000_000) * p.input +
    (output / 1_000_000) * p.output +
    (cacheRead / 1_000_000) * p.cacheRead +
    (cacheWrite / 1_000_000) * p.cacheWrite
  return cost
}

interface RecordArgs extends TokenCounts {
  userId?: string | null
  provider: UsageProvider
  model: string
  feature: UsageFeature
}

/**
 * Persist one usage event. Fire-and-forget — callers should NOT await this in a
 * way that blocks the response. Silently no-ops on any error or empty usage.
 */
export async function recordUsage(args: RecordArgs): Promise<void> {
  try {
    const input = args.inputTokens ?? 0
    const output = args.outputTokens ?? 0
    const cacheRead = args.cacheReadTokens ?? 0
    const cacheWrite = args.cacheWriteTokens ?? 0
    // Nothing meaningful to record.
    if (input + output + cacheRead + cacheWrite === 0) return

    const costUsd = computeCostUsd(args.model, args)
    await prisma.usageEvent.create({
      data: {
        userId: args.userId ?? null,
        provider: args.provider,
        model: args.model,
        feature: args.feature,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd,
      },
    })
  } catch {
    /* telemetry is best-effort — never surface to the user */
  }
}

// ── Provider-specific extractors (one-liners for call sites) ────────────────

// Anthropic Messages API usage shape.
interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** Record Anthropic usage. Fire-and-forget (returns void, no await needed). */
export function recordAnthropicUsage(
  usage: AnthropicUsage | null | undefined,
  ctx: { userId?: string | null; model: string; feature: UsageFeature },
): void {
  if (!usage) return
  void recordUsage({
    provider: 'anthropic',
    model: ctx.model,
    feature: ctx.feature,
    userId: ctx.userId,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  })
}

// Gemini usageMetadata shape.
interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number | null
}

/** Record Gemini usage. Fire-and-forget (returns void, no await needed). */
export function recordGeminiUsage(
  usage: GeminiUsage | null | undefined,
  ctx: { userId?: string | null; model: string; feature: UsageFeature },
): void {
  if (!usage) return
  void recordUsage({
    provider: 'google',
    model: ctx.model,
    feature: ctx.feature,
    userId: ctx.userId,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    cacheReadTokens: usage.cachedContentTokenCount ?? 0,
  })
}
