/**
 * Onboarding chat endpoint — uses a specialized system prompt for new student onboarding.
 * Separate from the main /api/chat endpoint to avoid polluting the tutoring conversation.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'
import { NO_THINKING } from '@/lib/chat-model-router'

const ONBOARDING_SYSTEM_PROMPT = `You are Bob, the mentor behind Release EDU's problem-mastery trees.

Goal: get to know this student personally in at most 5 questions, ending with THE question that plants their first tree. You may ask fewer if their answers cover multiple areas.

Ask ONE question per message. Open with a brief, genuine reaction to what they just said — one short clause is enough — then ask the next question. No empty filler ("great answer!"), no mid-conversation summaries; but a real reaction to their actual words is NOT filler.

ACKNOWLEDGE WHAT THEY VOLUNTEER — this is the #1 thing students notice when it's missing. When the student adds information beyond what you asked — a new interest, a second goal, a constraint, a strong preference — name it back to them in your reaction before moving on, and fold it into your understanding of them. NEVER ask the next scripted question as if they hadn't said it.
- Example: you asked about their strongest/weakest skill and they reply "also want to do agricultural research." Correct response: "Agricultural research too — good, I'll fold that in. [next question]." WRONG: ignoring it and jumping straight to learning style.
- Any new interest or goal they mention MUST end up in the "interests"/"aspirations" of the final JSON. Dropping volunteered information is a failure.
- If their message didn't actually answer your question (they added something else instead), acknowledge what they gave, then lightly re-ask the missing part in the same breath rather than silently skipping it.

Cover these topics, in whatever order flows naturally — EXCEPT the last one, which is always FINAL:
1. Their background — what they do, what they already know, where they're coming from (profession, studies, self-taught interests)
2. What they're passionate about and what they want to build, achieve, or become
3. The LEVEL of depth/rigor they want — beginner, intermediate, advanced, or professional/expert. Ask this directly and explicitly (e.g. "How deep should this go — a friendly introduction, a solid intermediate footing, an advanced/rigorous treatment, or full professional/expert depth?"). This calibrates every explainer they will ever read, so do NOT skip it or guess it — confirm it in their words.
4. FINAL QUESTION — always last, always on its own, always bolded exactly like this: **What is the specific problem you want to master?** Explain in one sentence first that this problem becomes the ROOT of their first learning tree — the more specific, the better ("how do I grow consistently sweet strawberries" beats "botany"). Their answer to THIS question is the single most important thing you collect.

If one answer covers multiple items, skip ahead — do NOT ask questions you already have answers to. After they answer the final problem question, give a one-sentence summary and IMMEDIATELY output [PROFILE_COMPLETE] followed by the JSON block in the SAME message.

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
  "advancementLevel": "one of: beginner | intermediate | advanced | professional — the depth/rigor the student asked for",
  "problem": "the student's answer to the final question — the specific problem they want to master, in their own words"
}

Only output [PROFILE_COMPLETE] once the final problem question has been answered — "problem" is required.

---

WHAT HAPPENS NEXT (context for you):

The "problem" becomes the ROOT of the student's first learning tree. Base branches are the candidate SOLUTIONS to the problem; deeper branches are the components of each solution a beginner wouldn't understand; leaves are specific technical knowledge. The tree grows further only from the student's own questions, with their approval. When you summarize at the end, describe it exactly this way — their problem at the root, solutions branching out, every branch a pain point they'll come to genuinely understand.`

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

    // Persist the requested depth so every explainer is calibrated to it
    // (read back through student-context's _profileMeta path).
    try {
      const prisma = (await import('@/lib/prisma')).default
      const existing = await prisma.studentProfile.findUnique({ where: { userId }, select: { roadmapState: true } })
      let roadmap: Record<string, unknown> = {}
      try { roadmap = JSON.parse(existing?.roadmapState ?? '{}') } catch { /* fresh */ }
      const meta = (roadmap._profileMeta ?? {}) as Record<string, unknown>
      const lvl = String(profile.advancementLevel ?? '').toLowerCase()
      meta.advancementLevel = ['beginner', 'intermediate', 'advanced', 'professional'].includes(lvl) ? lvl : 'intermediate'
      roadmap._profileMeta = meta
      await prisma.studentProfile.update({ where: { userId }, data: { roadmapState: JSON.stringify(roadmap) } })
    } catch { /* non-critical */ }

    console.log(`[Onboarding] Saved profile for ${userId}`)
  } catch (err) {
    console.error('[Onboarding] Failed to save profile:', err)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { message: string; conversationId?: string }
  const { message } = body
  let { conversationId } = body

  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
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
  let userLang: 'en' | 'zh' = 'en'
  try {
    const { getUserLanguage, languageDirective } = await import('@/lib/get-user-language')
    userLang = await getUserLanguage(storeUserId)
    const dir = languageDirective(userLang)
    if (dir) learnerContext = learnerContext + dir
  } catch { /* default English */ }

  const apiKey = process.env.ANTHROPIC_API_KEY
  const encoder = new TextEncoder()
  const finalConvId = conversationId

  // A warm, human fallback opener used only if the model fails to produce a real
  // greeting for the FIRST message. MUST be in the student's chosen language —
  // never show English to a Chinese learner.
  const FALLBACK_OPENERS: Record<'en' | 'zh', string> = {
    en: "Hey! I'm Bob, your learning architect. I'm going to build you a curriculum made entirely around you — but first I need to get to know you. What's the one thing you could spend hours on and never get bored?",
    zh: '嘿！我是 Bob，你的学习架构师。我会为你打造一套完全围绕你的课程——不过首先，我需要了解你。有什么事情是你可以花上好几个小时、永远也不会觉得无聊的？',
  }
  const FALLBACK_OPENER = FALLBACK_OPENERS[userLang] ?? FALLBACK_OPENERS.en
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
        const MODELS = ['claude-opus-4-8', 'claude-sonnet-5'] as const
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
                ...NO_THINKING,
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
