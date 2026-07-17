/**
 * Gemini AI integration for multimodal analysis and web research.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

// Gemini is the sole engine for understanding the learner's visual & auditory
// files (images, video, PDFs, voice notes) — it is more capable at multimodal
// than the teaching tier, so ALL such processing routes here, on Gemini's best
// FLASH model: strong at multimodal with the fast, low-cost latency that fits
// analysis running BEFORE Bob's reply. (Pinned like every other Gemini id in
// this file — the dynamic resolver governs the Anthropic teaching/judging
// tiers only.)
export const GEMINI_MULTIMODAL_MODEL = 'gemini-3-flash-preview'

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

// Web research for curriculum content
export async function searchForResources(
  query: string,
  subject: string
): Promise<{ title: string; url: string; type: string; description: string }[]> {
  const genAI = getClient()
  if (!genAI) return []
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' })
    const result = await model.generateContent(
      `Find 5 high-quality learning resources for: "${query}" in the subject of ${subject}.\n` +
      `For each provide: title, url (real URLs only), type (video/article/course/exercise), brief description.\n` +
      `Return ONLY a valid JSON array. No markdown fences. Example:\n` +
      `[{"title":"Khan Academy Calculus","url":"https://www.khanacademy.org/math/calculus-1","type":"course","description":"Free calculus course with exercises"}]`
    )
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { model: 'gemini-3-flash-preview', feature: 'research' })
    }
    const text = result.response.text().trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
    return JSON.parse(text) as { title: string; url: string; type: string; description: string }[]
  } catch {
    return []
  }
}

// Image/file analysis for multimodal learning
export async function analyzeImage(imageBase64: string, context: string, mimeType?: string): Promise<string> {
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
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MULTIMODAL_MODEL })
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: detectedMime, data: imageBase64 } },
    ])
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { model: GEMINI_MULTIMODAL_MODEL, feature: 'image' })
    }
    return result.response.text()
  } catch (err) {
    console.error(`Gemini multimodal analysis error (${GEMINI_MULTIMODAL_MODEL}):`, err)
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
  imageBase64: string, mimeType: string, request: string, context: string,
): Promise<{ confidence: number; issue: string } | null> {
  const genAI = getClient()
  if (!genAI) return null
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MULTIMODAL_MODEL })
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
      recordGeminiUsage(result.response.usageMetadata, { model: GEMINI_MULTIMODAL_MODEL, feature: 'image' })
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
  request: string, context: string,
): Promise<{ name: string; url: string; why: string } | null> {
  const genAI = getClient()
  if (!genAI) return null
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MULTIMODAL_MODEL })
    const result = await model.generateContent(
      `A learner needs to VISUALLY understand the following, and a generated static diagram was judged not good enough. Name the single BEST real, freely-accessible web resource for visually understanding exactly this — prefer interactive simulations and animations from well-known, reliable sources (PhET, GeoGebra, Desmos, Falstad, ophysics, 3Blue1Brown, Wikipedia's animated illustrations, university applets). The URL must be real and stable — if unsure of a deep link, give the site's search/landing URL that gets closest.

WHAT THEY NEED TO SEE: ${request.slice(0, 500)}
${context ? `LESSON CONTEXT: ${context.slice(0, 400)}` : ''}

Return ONLY JSON: {"name": "resource name", "url": "https://...", "why": "one sentence on what it shows and why it beats a static diagram — in the same language as the request"}`,
    )
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { model: GEMINI_MULTIMODAL_MODEL, feature: 'image' })
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

// Evaluate a multimodal student submission against pre-generated expectations
export async function evaluateSubmission(
  submissionBase64: string | null,
  submissionText: string,
  expectations: string,
  question: string,
  mimeType?: string
): Promise<{ score: number; verdict: 'excellent' | 'good' | 'partial' | 'insufficient'; learningGoalsMet: string[]; learningGoalsMissed: string[]; criticalThinking: string; creativity: string; feedback: string }> {
  const genAI = getClient()
  if (!genAI) {
    return { score: 50, verdict: 'partial', learningGoalsMet: [], learningGoalsMissed: [], criticalThinking: 'Unable to evaluate', creativity: 'Unable to evaluate', feedback: 'Multimodal evaluation unavailable.' }
  }
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro-preview-06-05' })
    const prompt = `You are evaluating a student's submission for a capstone problem set question.

**Question asked:**
${question}

**Pre-generated expectations (what a strong answer should demonstrate):**
${expectations}

**Student's text response:**
${submissionText || '(no text provided — evaluate the uploaded file only)'}

Evaluate the submission on these criteria:
1. **Learning goals met:** Which specific learning objectives from the expectations were demonstrated?
2. **Learning goals missed:** Which were not demonstrated or demonstrated incorrectly?
3. **Critical thinking:** Did the student show reasoning beyond rote recall? Did they connect ideas, identify nuances, or show analytical depth? Be specific about what they did or didn't do.
4. **Creativity:** Did the student bring original examples, novel perspectives, or unexpected connections? Only note this if genuinely present — do not penalize absence of creativity in quantitative/technical questions.
5. **Score:** 0–100 based on how well the submission meets the expectations.

Return ONLY valid JSON. No markdown fences. Format:
{"score":75,"verdict":"good","learningGoalsMet":["goal 1","goal 2"],"learningGoalsMissed":["goal 3"],"criticalThinking":"one sentence assessment","creativity":"one sentence assessment","feedback":"2-3 sentences of specific, actionable feedback"}`

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }]
    if (submissionBase64 && mimeType) {
      parts.push({ inlineData: { mimeType, data: submissionBase64 } })
    }

    const result = await model.generateContent(parts)
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { model: 'gemini-2.5-pro-preview-06-05', feature: 'capstone' })
    }
    const text = result.response.text().trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(text)
  } catch (err) {
    console.error('Gemini submission evaluation error:', err)
    return { score: 50, verdict: 'partial', learningGoalsMet: [], learningGoalsMissed: [], criticalThinking: 'Evaluation error', creativity: 'Evaluation error', feedback: 'Could not evaluate submission. Please try again.' }
  }
}

// Research existing curricula from real institutions for a given topic
export async function researchExistingCurricula(topic: string, relatedInterests: string): Promise<string> {
  const genAI = getClient()
  if (!genAI) return ''
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' })
    const result = await model.generateContent(
      `Search for real university courses, K-12 curricula, MOOCs, and professional training programs related to: "${topic}" and "${relatedInterests}".\n\n` +
      `For each program found, provide:\n` +
      `- Institution name (e.g. MIT, Stanford, Khan Academy, Coursera)\n` +
      `- Course/program title\n` +
      `- Key topics and chapter/module structure they use\n` +
      `- Target audience level (beginner, intermediate, advanced)\n` +
      `- Approximate duration\n\n` +
      `Find 3-5 real programs. Focus on how they structure the subject — what topics come first, what order, what depth.\n` +
      `Be factual — only reference programs that actually exist. Use plain text.`
    )
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { model: 'gemini-3-flash-preview', feature: 'curriculum' })
    }
    return result.response.text()
  } catch {
    return ''
  }
}

// Research a topic for curriculum building
export async function researchTopic(topic: string): Promise<string> {
  const genAI = getClient()
  if (!genAI) return ''
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' })
    const result = await model.generateContent(
      `Research this topic for educational curriculum design: "${topic}".\n` +
      `Provide:\n` +
      `- Key concepts to cover (5-8 items)\n` +
      `- Prerequisite knowledge needed\n` +
      `- 3 compelling project ideas\n` +
      `- Real-world applications (3-5 examples)\n` +
      `- Recommended learning sequence\n` +
      `Be thorough but concise. Use plain text.`
    )
    {
      const { recordGeminiUsage } = await import('@/lib/usage')
      recordGeminiUsage(result.response.usageMetadata, { model: 'gemini-3-flash-preview', feature: 'curriculum' })
    }
    return result.response.text()
  } catch {
    return ''
  }
}
