/**
 * POST /api/image/generate  { prompt }
 *
 * Generates an educational concept illustration via the Gemini image API
 * (a.k.a. "Nano Banana"). Results are cached durably in the DB keyed by a hash
 * of the full prompt, so each unique concept image is generated only once —
 * keeping cost minimal even though Bob may reference the same illustration
 * across reloads and students.
 *
 * Bob triggers this by emitting a ```image``` block in his reply; the chat UI
 * parses it and calls this route. Configure the model with GEMINI_IMAGE_MODEL;
 * otherwise a list of known image models is tried in order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSlotAwareSession } from '@/lib/session-slots'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'

// Image generation can take 10–20s — give it headroom on Vercel.
export const maxDuration = 60

// "Nano Banana 2" = Gemini 3.1 Flash Image. Use it directly; fall back to
// Gemini 3 Pro Image, then older image models as a last resort. Override with
// GEMINI_IMAGE_MODEL to pin a specific one.
const IMAGE_MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  'gemini-3.1-flash-image',           // Nano Banana 2 — primary
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',               // fallback
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image',           // older fallback
  'gemini-2.5-flash-image-preview',
].filter(Boolean) as string[]

export async function POST(req: NextRequest) {
  // Gate the expensive endpoint to authenticated users (login is required
  // product-wide — demo mode is gone).
  const session = await getSlotAwareSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { prompt, context } = (await req.json().catch(() => ({}))) as { prompt?: string; context?: string }
  if (!prompt || !prompt.trim()) {
    return NextResponse.json({ error: 'No prompt' }, { status: 400 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Image generation is not configured.' }, { status: 503 })
  }

  // Ground the image in what the student is actively learning (the surrounding
  // chat content), so the illustration matches the lesson rather than a generic
  // stock picture. Steer toward a clean, labeled, textbook-style diagram.
  const ctx = (context ?? '').toString().replace(/\s+/g, ' ').trim().slice(0, 900)
  const fullPrompt =
    `Create a clear, educational illustration to help a student understand this concept, ` +
    `grounded in exactly what they are learning right now. Clean, well-labeled, textbook/diagram ` +
    `style on a simple light background. Accurate and uncluttered. No watermarks or signatures.\n\n` +
    (ctx ? `What the student is learning right now (use this for accuracy and relevance):\n${ctx}\n\n` : '') +
    `Illustration to create: ${prompt.trim()}`
  const promptHash = createHash('sha256').update(fullPrompt).digest('hex')

  // ── Visual-confidence law (FOUNDATION.md) ──
  // Every generated visual is self-evaluated: does it CONFIDENTLY answer the
  // request? The score ships to the UI as a confidence bar; below the
  // threshold, the best REAL visual resource is researched and returned so
  // the learner is explicitly redirected instead of taught from a bad diagram.
  const CONFIDENCE_THRESHOLD = 60
  const evaluate = async (dataUrl: string) => {
    try {
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
      if (!m) return { confidence: null as number | null, issue: '', redirect: null as { name: string; url: string; why: string } | null }
      const { evaluateGeneratedVisual, recommendVisualResource } = await import('@/lib/gemini')
      const ev = await evaluateGeneratedVisual(m[2], m[1], prompt.trim(), ctx)
      if (!ev) return { confidence: null, issue: '', redirect: null }
      const redirect = ev.confidence < CONFIDENCE_THRESHOLD
        ? await recommendVisualResource(prompt.trim(), ctx)
        : null
      return { confidence: ev.confidence, issue: ev.issue, redirect }
    } catch {
      return { confidence: null, issue: '', redirect: null }
    }
  }

  // Durable cache — generate each unique concept image exactly once.
  try {
    const cached = await prisma.generatedImage.findUnique({ where: { promptHash } })
    if (cached) {
      // Legacy rows predate the confidence columns — evaluate once, backfill.
      if (cached.confidence === null || cached.confidence === undefined) {
        const { confidence, issue, redirect } = await evaluate(cached.dataUrl)
        if (confidence !== null) {
          await prisma.generatedImage.update({
            where: { promptHash },
            data: { confidence, redirectJson: redirect ? JSON.stringify(redirect) : null },
          }).catch(() => null)
          return NextResponse.json({ image: cached.dataUrl, cached: true, confidence, issue, redirect })
        }
        return NextResponse.json({ image: cached.dataUrl, cached: true })
      }
      let redirect: { name: string; url: string; why: string } | null = null
      try { redirect = cached.redirectJson ? JSON.parse(cached.redirectJson) : null } catch { /* malformed */ }
      return NextResponse.json({ image: cached.dataUrl, cached: true, confidence: cached.confidence, redirect })
    }
  } catch { /* table may not be migrated yet — fall through and generate */ }

  const tried = new Set<string>()
  for (const model of IMAGE_MODELS) {
    if (tried.has(model)) continue
    tried.add(model)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        },
      )
      if (!res.ok) continue
      const data = await res.json() as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      }
      const parts = data?.candidates?.[0]?.content?.parts ?? []
      const imgPart = parts.find(p => p?.inlineData?.data)
      if (!imgPart?.inlineData?.data) continue
      // Cost telemetry — every AI call records usage with its feature tag.
      try {
        const [{ recordGeminiUsage }, { getUserId }] = await Promise.all([
          import('@/lib/usage'), import('@/lib/get-user-id'),
        ])
        recordGeminiUsage(data.usageMetadata, { userId: await getUserId(), model, feature: 'image' })
      } catch { /* non-critical */ }
      const mime = imgPart.inlineData.mimeType || 'image/png'
      const dataUrl = `data:${mime};base64,${imgPart.inlineData.data}`
      // Self-evaluate the fresh image (visual-confidence law) before storing,
      // so the verdict + any redirect are cached alongside it forever.
      const { confidence, issue, redirect } = await evaluate(dataUrl)
      // Best-effort durable store (ignore unique-races / missing-table).
      try {
        await prisma.generatedImage.create({
          data: {
            promptHash, prompt: prompt.trim().slice(0, 1000), dataUrl, model,
            confidence, redirectJson: redirect ? JSON.stringify(redirect) : null,
          },
        })
      } catch { /* non-critical */ }
      return NextResponse.json({ image: dataUrl, model, confidence, issue, redirect })
    } catch {
      continue
    }
  }

  return NextResponse.json({ error: 'Could not generate an image right now.' }, { status: 502 })
}
