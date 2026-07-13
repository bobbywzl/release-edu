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
import { getServerSession } from 'next-auth'
import { createHash } from 'crypto'
import { authOptions } from '@/lib/auth'
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
  const session = await getServerSession(authOptions)
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

  // Durable cache — generate each unique concept image exactly once.
  try {
    const cached = await prisma.generatedImage.findUnique({ where: { promptHash } })
    if (cached) return NextResponse.json({ image: cached.dataUrl, cached: true })
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
      // Best-effort durable store (ignore unique-races / missing-table).
      try {
        await prisma.generatedImage.create({
          data: { promptHash, prompt: prompt.trim().slice(0, 1000), dataUrl, model },
        })
      } catch { /* non-critical */ }
      return NextResponse.json({ image: dataUrl, model })
    } catch {
      continue
    }
  }

  return NextResponse.json({ error: 'Could not generate an image right now.' }, { status: 502 })
}
