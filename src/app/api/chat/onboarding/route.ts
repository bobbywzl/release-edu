/**
 * Onboarding chat endpoint — uses a specialized system prompt for new student onboarding.
 * Separate from the main /api/chat endpoint to avoid polluting the tutoring conversation.
 */
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

const ONBOARDING_SYSTEM_PROMPT = `You are Bob, the learning architect for Release EDU.

Goal: build a great personalized curriculum from at most 5 questions. You may ask fewer if the student's answers cover multiple areas.

Ask ONE question per message. Be brief — 1 sentence reaction max before the next question. No filler, no "great answer!", no summaries mid-conversation.

Cover these topics, in whatever order flows naturally:
1. What they're passionate about (the thing they'd do all day)
2. What they want to build, achieve, or become
3. How they prefer to learn (hands-on / reading / discussion)
4. A strength and a weakness
5. What frustrated them about traditional school

If one answer covers multiple items, skip ahead — do NOT ask questions you already have answers to. As soon as you have enough information to build a strong curriculum (even if fewer than 5 questions), give one sentence summary and IMMEDIATELY output [PROFILE_COMPLETE] followed by the JSON block in the SAME message.

CRITICAL RULES FOR COMPLETION:
- Do NOT split the summary and the JSON into separate messages
- Do NOT send a summary without the JSON
- Do NOT say things like "let me build your curriculum" or "I'll create your learning path" without ALSO including [PROFILE_COMPLETE] and the JSON in that SAME message
- The [PROFILE_COMPLETE] tag + JSON MUST appear in the SAME response as your final summary
- NEVER send a message that indicates you are about to build the curriculum without the [PROFILE_COMPLETE] tag — the system CANNOT start building without it
- If you are ready to build, you MUST include [PROFILE_COMPLETE] — there is no other way to trigger curriculum generation

Your VERY FIRST message to a brand-new student: one warm sentence + your first question only. Nothing else. Never output any placeholder, control token, or system marker — always write real, human prose.

Once done, output [PROFILE_COMPLETE]:

[PROFILE_COMPLETE]
{
  "interests": ["interest1", "interest2"],
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1"],
  "learningStyle": "visual / hands-on / reading / discussion",
  "personalityTraits": ["trait1", "trait2"],
  "aspirations": "what they want to become or build",
  "educationFrustrations": ["what they disliked about traditional school e.g. memorization, no creativity, irrelevant content"],
  "baselineAssessment": {
    "math": 7,
    "writing": 5,
    "science": 6,
    "history": 4,
    "criticalThinking": 8
  }
}

Only output [PROFILE_COMPLETE] when you genuinely have enough information to build a great curriculum.

---

HOW THE CURRICULUM WILL BE BUILT (context for you):

When this profile is sent to curriculum generation, it will produce TWO distinct tracks, each containing several COURSES:

**INTEREST-BASED track** — courses that go DEEP into the student's field. Specialized sub-disciplines of exactly what they love. A student into Buddhist philosophy gets courses like "Tibetan Buddhist Studies", "Buddhist Epistemology", "Philosophy of Mind in Buddhism" — NOT generic philosophy. A game dev student gets "Game Engine Architecture", "Procedural Level Design" — NOT "Computer Science".

**FOUNDATION track** — courses in traditional academic disciplines that SUPPORT or UNDERPIN the interest, but are not the interest itself. Adjacent knowledge that makes them better at their field. Buddhist philosophy → History of Religion, Sanskrit, Neuroscience of Meditation. Game dev → Linear Algebra, Psychology of Play.

TERMINOLOGY — use this consistently when talking to the student:
- A **track** is one of the two top-level groupings: "Foundations" or "Interest-Based".
- A **course** is an item inside a track (formal academic course title).
- A **chapter** is an item inside a course (one focused topic, ~5–12 hours).
- Never say "subject" or "module" when referring to courses — always say "course".

Keep this in mind when summarizing their curriculum preview at the end — describe the kind of specialized COURSES they'll get, not just "some project-based and some core subjects."`

/**
 * Save the onboarding profile to the student record and insights.
 * Called fire-and-forget when [PROFILE_COMPLETE] is detected.
 */
async function saveOnboardingProfile(userId: string, profile: Record<string, unknown>) {
  try {
    const store = dbStore.forUser(userId)

    // Save profile fields + mark onboarded
    await store.updateProfile({
      interests: JSON.stringify(profile.interests || []),
      strengths: JSON.stringify(profile.strengths || []),
      weaknesses: JSON.stringify(profile.weaknesses || []),
      learningStyle: (profile.learningStyle as string) || 'visual',
      aspirations: (profile.aspirations as string) || '',
      isOnboarded: true,
    })

    // Save insights for later use
    const interests = (profile.interests || []) as string[]
    const strengths = (profile.strengths || []) as string[]
    for (const interest of interests) {
      await store.addInsight({ type: 'interest', content: interest, confidence: 0.85, source: 'onboarding' })
    }
    for (const strength of strengths) {
      await store.addInsight({ type: 'strength', content: strength, confidence: 0.8, source: 'onboarding' })
    }
    if (profile.aspirations) {
      await store.addInsight({ type: 'aspiration', content: profile.aspirations as string, confidence: 0.9, source: 'onboarding' })
    }

    console.log(`[Onboarding] Saved profile for ${userId}`)
  } catch (err) {
    console.error('[Onboarding] Failed to save profile:', err)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { message: string; conversationId?: string }
  const { message } = body
  let { conversationId } = body

  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const session = await getServerSession(authOptions)

  if (!session?.user && !isDemo) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (isDemo) {
    return new Response('Demo mode — onboarding not available', { status: 403 })
  }

  const storeUserId = await getUserId()
  const store = dbStore.forUser(storeUserId)

  // Manage onboarding conversation
  if (!conversationId) {
    const conv = await store.createConversation('Onboarding with Bob', 'onboarding')
    conversationId = conv.id
  }

  const isStartMessage = message === '__START__'
  if (!isStartMessage) {
    await store.addMessage(conversationId, 'user', message)
  }

  const conv = await store.getConversation(conversationId)
  const history = (conv?.messages ?? [])
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // Load the setup info the student filled in BEFORE the chat — name, age,
  // education level, occupation, organization. Bob uses these to tailor the
  // tone, depth, and examples of his questions instead of starting blind.
  let learnerContext = ''
  try {
    const savedProfile = await store.getProfile()
    const meta = savedProfile?.roadmapState
      ? (JSON.parse(savedProfile.roadmapState)?._profileMeta ?? {})
      : {}
    let age: number | null = null
    if (meta.birthdate) {
      const birth = new Date(meta.birthdate)
      const today = new Date()
      age = today.getFullYear() - birth.getFullYear()
      if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--
    }
    const orgLine = meta.isIndividual
      ? 'learning independently (no formal school/org)'
      : (meta.organization ? `at ${meta.organization}` : null)
    const parts = [
      meta.name ? `Name: ${meta.name}` : null,
      age != null ? `Age: ${age}` : null,
      meta.education ? `Education level: ${meta.education}` : null,
      meta.occupation ? `Occupation: ${meta.occupation}` : null,
      orgLine ? `Context: ${orgLine}` : null,
    ].filter(Boolean)
    if (parts.length) {
      learnerContext = `\n\n---\n\nKNOWN ABOUT THE STUDENT (from the setup form they just completed — use this to calibrate your questions, tone, vocabulary, and examples; do NOT re-ask any of these):\n${parts.join('\n')}\n\nADAPT YOUR APPROACH:\n- Address them by their first name occasionally to feel personal\n- Calibrate complexity to their age and education level (a 10-year-old gets simpler, more playful questions; a 30-year-old professional gets sharper, more career-relevant questions)\n- If they have a relevant occupation, factor that in (a software engineer asking about game dev doesn't need basic CS questions; a doctor exploring neuroscience can handle technical depth)\n- If they're learning independently, frame questions around self-direction and personal goals, not classroom contexts`
    }
  } catch { /* ignore — Bob will fall back to generic onboarding */ }

  // Language: onboarding conversation in the student's chosen language.
  try {
    const { getUserLanguage, languageDirective } = await import('@/lib/get-user-language')
    const lang = await getUserLanguage(storeUserId)
    const dir = languageDirective(lang)
    if (dir) learnerContext = learnerContext + dir
  } catch { /* default English */ }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const encoder = new TextEncoder()
  const finalConvId = conversationId

  // A warm, human fallback opener. Used only if the model fails to produce a
  // real greeting for the FIRST message (e.g. it parrots the start sentinel).
  const FALLBACK_OPENER = "Hey! I'm Bob, your learning architect. I'm going to build you a curriculum made entirely around you — but first I need to get to know you. What's the one thing you could spend hours on and never get bored?"
  // Detects a degenerate first-message response: empty, or the model echoing
  // the "__START__" trigger (or any near-variant) instead of greeting.
  const isDegenerateOpener = (s: string) => {
    const t = (s || '').trim()
    if (!t) return true
    return /^_{0,2}\s*start\s*_{0,2}$/i.test(t)
  }

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''

      if (!apiKey) {
        // No fake Bob responses — onboarding is too important to fake. Surface
        // the real problem so it gets fixed instead of silently confusing users
        // with hardcoded canned puzzles.
        const errMsg = "Onboarding requires the AI service, which isn't reachable right now. Please refresh and try again — if this persists, the server's ANTHROPIC_API_KEY env var needs to be set."
        fullResponse = errMsg
        controller.enqueue(encoder.encode(errMsg))
      } else {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey })

        const messages = isStartMessage
          ? [{ role: 'user' as const, content: 'Please start the onboarding conversation with your warm welcome and first question.' }]
          : history

        // Error classification helpers.
        const isOverload = (err: unknown): boolean => {
          if (!err || typeof err !== 'object') return false
          const e = err as { status?: number; error?: { error?: { type?: string }; type?: string } }
          if (e.status === 529) return true
          const innerType = e.error?.error?.type ?? e.error?.type
          return innerType === 'overloaded_error'
        }
        const isAuthError = (err: unknown): boolean => {
          if (!err || typeof err !== 'object') return false
          const e = err as { status?: number; error?: { error?: { type?: string }; type?: string } }
          if (e.status === 401 || e.status === 403) return true
          const innerType = e.error?.error?.type ?? e.error?.type
          return innerType === 'authentication_error' || innerType === 'permission_error'
        }
        const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

        // Try opus first (highest quality for onboarding), fall back to sonnet
        // if opus stays overloaded — sonnet typically has more capacity. Each
        // model gets its own 4-attempt retry budget with exponential backoff.
        const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6'] as const
        const RETRY_DELAYS_MS = [1500, 3000, 6000]
        let succeeded = false
        let lastErr: unknown = null

        // For the FIRST message we buffer the model output and validate it
        // before sending anything, so a degenerate echo of the "__START__"
        // trigger can never reach the client — we just retry/fall back. For
        // normal turns we stream token-by-token as usual.
        outer:
        for (const model of MODELS) {
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const response = await client.messages.stream({
                model,
                max_tokens: 1024,
                system: ONBOARDING_SYSTEM_PROMPT + learnerContext,
                messages,
              })
              let attemptText = ''
              for await (const chunk of response) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  attemptText += chunk.delta.text
                  if (!isStartMessage) {
                    // Normal turn: stream live.
                    fullResponse += chunk.delta.text
                    controller.enqueue(encoder.encode(chunk.delta.text))
                  }
                }
              }
              if (isStartMessage) {
                // Validate the buffered opener before committing it.
                if (isDegenerateOpener(attemptText)) {
                  console.warn(`[Onboarding] ${model} returned a degenerate opener ("${attemptText.trim().slice(0, 20)}") — retrying`)
                  lastErr = new Error('degenerate opener')
                  if (attempt < 3) { await sleep(RETRY_DELAYS_MS[attempt]); continue }
                  break // out of retries on this model → try next model
                }
                fullResponse = attemptText
                controller.enqueue(encoder.encode(attemptText))
              }
              try {
                const { recordAnthropicUsage } = await import('@/lib/usage')
                recordAnthropicUsage((await response.finalMessage()).usage, { userId: storeUserId, model, feature: 'onboarding' })
              } catch { /* usage best-effort */ }
              succeeded = true
              break outer
            } catch (err) {
              lastErr = err
              // Auth errors are not retryable — surface immediately.
              if (isAuthError(err)) break outer
              if (isOverload(err) && attempt < 3) {
                const delay = RETRY_DELAYS_MS[attempt]
                console.warn(`[Onboarding] ${model} overloaded — retrying in ${delay}ms (attempt ${attempt + 2}/4)`)
                fullResponse = ''
                await sleep(delay)
                continue
              }
              // Out of retries on this model — break inner loop, try next model.
              fullResponse = ''
              break
            }
          }
        }

        // First message is too important to fail: if every model/attempt
        // produced a degenerate or failed opener, send the warm fallback
        // instead of an error so the student always gets a real welcome.
        if (!succeeded && isStartMessage) {
          fullResponse = FALLBACK_OPENER
          controller.enqueue(encoder.encode(FALLBACK_OPENER))
          succeeded = true
        }

        if (!succeeded) {
          console.error('Onboarding chat error after all models/retries:', lastErr)
          let errMsg: string
          if (isAuthError(lastErr)) {
            errMsg = "The AI service rejected the credentials. The server's ANTHROPIC_API_KEY env var looks invalid — please fix it and refresh."
          } else if (isOverload(lastErr)) {
            errMsg = "Anthropic's API is at capacity right now (this is a temporary issue on their end, not your account). Wait 30 seconds and send your message again."
          } else {
            errMsg = "I couldn't reach the AI service. Send your message again — most network blips clear on retry."
          }
          fullResponse = errMsg
          controller.enqueue(encoder.encode(errMsg))
        }
      }

      await store.addMessage(finalConvId, 'assistant', fullResponse.trim())

      // Check if Bob completed the profile
      if (fullResponse.includes('[PROFILE_COMPLETE]')) {
        const profileMatch = fullResponse.match(/\[PROFILE_COMPLETE\]\s*(\{[\s\S]*?\})\s*(?:\[|$)/)
        if (profileMatch) {
          try {
            const profile = JSON.parse(profileMatch[1])
            // Fire and forget — save profile and mark onboarded in background
            void saveOnboardingProfile(storeUserId, profile)
          } catch (e) {
            console.error('[Onboarding] Failed to parse profile:', e)
          }
        }
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Conversation-Id': finalConvId,
    },
  })
}
