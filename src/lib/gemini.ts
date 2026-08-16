/**
 * Gemini AI integration for multimodal analysis and web research.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

// Gemini is the sole engine for understanding the learner's visual & auditory
// files (images, video, PDFs, voice notes) — it is more capable at multimodal
// than the teaching tier, so ALL such processing routes here, on Gemini's best
// FLASH model. The pinned id below is the permanent fallback; the resolver
// underneath auto-adopts the newest flash release (user directive, Aug 2026:
// every tier tracks the latest of its corresponding model family).
export const GEMINI_MULTIMODAL_MODEL = 'gemini-3-flash-preview'

// ── Latest-flash resolver ──
// Google's ListModels carries no release dates, so "newest" is the highest
// version number among generateContent-capable plain-flash models (previews
// included; a stable id beats a preview at the same version). 6h cache on
// success, 5min negative cache, 4s hard timeout — resolution can never hang
// a turn, and any failure serves the pinned id.
const FLASH_TTL_MS = 6 * 60 * 60 * 1000
const FLASH_FAIL_TTL_MS = 5 * 60 * 1000
let flashCache: { at: number; id: string; ok: boolean } | null = null
let flashInflight: Promise<string> | null = null

async function fetchLatestFlash(apiKey: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`gemini models list ${res.status}`)
    const body = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }
    let best: { id: string; ver: number; stable: number } | null = null
    for (const m of body.models ?? []) {
      const id = (m.name ?? '').replace(/^models\//, '')
      // The plain flash line only — never -lite/-image/-tts/-live variants.
      const match = id.match(/^gemini-(\d+(?:\.\d+)?)-flash(?:-preview)?(?:-\d[\d-]*)?$/)
      if (!match) continue
      if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue
      const ver = parseFloat(match[1])
      const stable = id.includes('preview') ? 0 : 1
      if (!best || ver > best.ver || (ver === best.ver && stable > best.stable)) best = { id, ver, stable }
    }
    return best?.id ?? GEMINI_MULTIMODAL_MODEL
  } finally {
    clearTimeout(timer)
  }
}

/** The multimodal model — newest Gemini flash, pinned-id fallback. */
export async function getMultimodalModel(): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return GEMINI_MULTIMODAL_MODEL
  const ttl = flashCache?.ok ? FLASH_TTL_MS : FLASH_FAIL_TTL_MS
  if (flashCache && Date.now() - flashCache.at < ttl) return flashCache.id
  if (!flashInflight) {
    flashInflight = fetchLatestFlash(apiKey)
      .then(id => { flashCache = { at: Date.now(), id, ok: true }; return id })
      .catch(() => {
        const id = flashCache?.id ?? GEMINI_MULTIMODAL_MODEL
        flashCache = { at: Date.now(), id, ok: false }
        return id
      })
      .finally(() => { flashInflight = null })
  }
  return flashInflight
}

function getClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  return new GoogleGenerativeAI(apiKey)
}

// Detect MIME type from file buffer or explicit type
function detectMimeType(base64Data: string, explicitType?: string): string {
  if (explicitType && explicitType !== 'application/octet-stream') return explicitType
  // Detect from base64 magic bytes
  const header = base64Data.slice(0, 8)
  try {
    const bytes = Buffer.from(header, 'base64')
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg'
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
    if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp'
    if (bytes[0] === 0x25 && bytes[1] === 0x50) return 'application/pdf'
  } catch {}
  return 'image/jpeg' // fallback
}

// (Release EDU's curriculum-research helpers — searchForResources,
// evaluateSubmission, researchExistingCurricula, researchTopic — are DELETED:
// zero callers since the pivot, and they pinned hardcoded Gemini model ids.)

// Image/file analysis for multimodal learning. userId attributes the spend
// to the learner so the per-user budget gate actually sees Gemini usage.
export async function analyzeImage(imageBase64: string, context: string, mimeType?: string, userId?: string): Promise<string> {
  const genAI = getClient()
  if (!genAI) return 'Image analysis unavailable — no Gemini API key configured.'
  
  const detectedMime = detectMimeType(imageBase64, mimeType)
  const isVideo = detectedMime.startsWith('video/')
  const isAudio = detectedMime.startsWith('audio/')
  const isPDF = detectedMime === 'application/pdf'

  const prompt = isAudio
    ? `This is a voice recording from a student, in the context of: ${context}. First TRANSCRIBE what they said (verbatim, in the language spoken). Then, in one short paragraph, note anything relevant beyond the words themselves (described objects/sounds, uncertainty, emphasis). Format: "TRANSCRIPT: ..." then "NOTES: ...".`
    : isVideo
    ? `Analyze this video in the context of: ${context}. Describe what's shown, explain key concepts, and explain how it relates to the student's learning. Be thorough.`
    : isPDF
    ? `Analyze this PDF document in the context of: ${context}. Extract key information, summarize main points, and explain how it relates to the student's learning.`
    : `Analyze this image in the context of: ${context}. Describe what you see in detail, explain any relevant concepts, and suggest how this relates to the student's learning. Be thorough and helpful.`

  // Genuine multimodal understanding on Gemini's best flash model, with a
  // graceful degrade if it errors (rate limit / unavailable) so a bad call
  // never kills the turn.
  const mmModel = await getMultimodalModel()
  try {
    const model = genAI.getGenerativeModel({ model: mmModel })
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: detectedMime, data: imageBase64 } },
    ])
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { userId, model: mmModel, feature: 'image' })
    }
    return result.response.text()
  } catch (err) {
    console.error(`Gemini multimodal analysis error (${mmModel}):`, err)
  }
  // Degrade gracefully instead of killing the turn.
  return `I can see you've shared a ${isVideo ? 'video' : isAudio ? 'voice note' : isPDF ? 'PDF' : 'file'}. Could you tell me what you'd like to discuss about it?`
}

// Video analysis specifically
export async function analyzeVideo(videoBase64: string, mimeType: string, context: string): Promise<string> {
  return analyzeImage(videoBase64, context, mimeType)
}

/**
 * Visual-confidence law (FOUNDATION.md): score whether a GENERATED diagram
 * confidently answers the request it was drawn for. Harsh by design — wrong
 * geometry, mislabeled arrows, clutter, or missing named elements must pull
 * the score down, because an inaccurate diagram teaches the error. Returns
 * null on any failure (the caller treats that as "unevaluated", never as
 * confident).
 */
export async function evaluateGeneratedVisual(
  imageBase64: string, mimeType: string, request: string, context: string, userId?: string,
): Promise<{ confidence: number; issue: string } | null> {
  const genAI = getClient()
  if (!genAI) return null
  const mmModel = await getMultimodalModel()
  try {
    const model = genAI.getGenerativeModel({ model: mmModel })
    const result = await model.generateContent([
      { text: `You are a strict reviewer of educational diagrams. This image was generated to satisfy the request below. Score 0-100: does it ACCURATELY and CLEARLY deliver exactly what was requested, well enough to teach from?

REQUEST: ${request.slice(0, 500)}
${context ? `LESSON CONTEXT: ${context.slice(0, 400)}` : ''}

Score harshly. Deduct heavily for: incorrect geometry/physics/math, arrows or labels pointing at the wrong thing, garbled or misspelled labels, cluttered or ambiguous layout, missing elements the request explicitly named, or anything that would mislead a learner. A merely decorative or vaguely-related image scores below 40. Reserve 80+ for diagrams a textbook could print as-is.

Return ONLY JSON: {"confidence": 0-100, "issue": "the single biggest flaw, one short phrase, in the same language as the request (empty string if none)"}` },
      { inlineData: { mimeType, data: imageBase64 } },
    ])
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { userId, model: mmModel, feature: 'image' })
    }
    const text = result.response.text().trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(text) as { confidence?: number; issue?: string }
    if (typeof parsed.confidence !== 'number') return null
    return {
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))),
      issue: String(parsed.issue ?? '').slice(0, 200),
    }
  } catch (err) {
    console.error('Gemini visual evaluation error:', err)
    return null
  }
}

/**
 * When a generated diagram can't confidently deliver the request, research the
 * best REAL visual resource (interactive simulation, animation, video, visual
 * article) and return it so the UI can redirect the learner — explicitly, per
 * the visual-confidence law. Returns null on failure.
 */
export async function recommendVisualResource(
  request: string, context: string, userId?: string,
): Promise<{ name: string; url: string; why: string } | null> {
  const genAI = getClient()
  if (!genAI) return null
  const mmModel = await getMultimodalModel()
  try {
    const model = genAI.getGenerativeModel({ model: mmModel })
    const result = await model.generateContent(
      `A learner needs to VISUALLY understand the following, and a generated static diagram was judged not good enough. Name the single BEST real, freely-accessible web resource for visually understanding exactly this — prefer interactive simulations and animations from well-known, reliable sources (PhET, GeoGebra, Desmos, Falstad, ophysics, 3Blue1Brown, Wikipedia's animated illustrations, university applets). The URL must be real and stable — if unsure of a deep link, give the site's search/landing URL that gets closest.

WHAT THEY NEED TO SEE: ${request.slice(0, 500)}
${context ? `LESSON CONTEXT: ${context.slice(0, 400)}` : ''}

Return ONLY JSON: {"name": "resource name", "url": "https://...", "why": "one sentence on what it shows and why it beats a static diagram — in the same language as the request"}`,
    )
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { userId, model: mmModel, feature: 'image' })
    }
    const text = result.response.text().trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(text) as { name?: string; url?: string; why?: string }
    if (!parsed.name || !parsed.url || !/^https?:\/\//.test(parsed.url)) return null
    return {
      name: String(parsed.name).slice(0, 120),
      url: String(parsed.url).slice(0, 500),
      why: String(parsed.why ?? '').slice(0, 300),
    }
  } catch (err) {
    console.error('Gemini visual-resource recommendation error:', err)
    return null
  }
}
