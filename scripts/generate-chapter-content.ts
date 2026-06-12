// scripts/generate-chapter-content.ts
// Run with: npx tsx scripts/generate-chapter-content.ts
//
// Iterates all chapters with placeholder content and generates rich syllabus
// using Claude Opus. Respects rate limits with delays between calls.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set')
    process.exit(1)
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  // Find all chapters with placeholder or missing content
  const chapters = await prisma.chapter.findMany({
    where: {
      OR: [
        { content: null },
        { content: '' },
        { content: { contains: 'Content will be generated' } },
        { content: { contains: 'Content to be generated' } },
      ],
    },
    include: {
      track: {
        select: { name: true, userId: true, type: true },
      },
    },
  })

  console.log(`Found ${chapters.length} chapters with placeholder content.\n`)

  if (chapters.length === 0) {
    console.log('✅ All chapters already have content.')
    return
  }

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]
    const keyTopics = chapter.keyTopics ? JSON.parse(chapter.keyTopics) : []

    console.log(
      `[${i + 1}/${chapters.length}] Generating: "${chapter.title}" (${chapter.track.name})...`,
    )

    // Fetch student profile for personalisation
    let interests = 'not specified'
    let learningStyle = 'not specified'
    try {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: chapter.track.userId },
        select: { interests: true, learningStyle: true },
      })
      if (profile?.interests) {
        interests = JSON.parse(profile.interests as string).join(', ')
      }
      if (profile?.learningStyle) {
        learningStyle = profile.learningStyle
      }
    } catch {
      // Non-critical
    }

    const prompt = `You are a world-class educator writing comprehensive course material.

Generate a complete, rich chapter syllabus for:

**Chapter:** ${chapter.title}
**Subject:** ${chapter.track.name}
**Key Topics:** ${keyTopics.join(', ')}
**Student interests:** ${interests}
**Learning style:** ${learningStyle}

Write the full chapter content in structured markdown. This will be the authoritative source material Bob uses to teach this chapter. Include:

1. **Overview** — 2-3 sentences explaining what this chapter is about and why it matters
2. **Core Concepts** — For each key topic: clear definition, explanation, and a concrete real-world example. Be thorough and precise.
3. **Key Distinctions** — Common confusions or important nuances students must understand (3-5 points)
4. **Examples & Analogies** — 2-3 worked examples or analogies that make abstract concepts tangible
5. **Common Misconceptions** — What students typically get wrong and why
6. **Connections** — How this chapter connects to other concepts in ${chapter.track.name}
7. **Learning Objectives** — Numbered list of exactly what the student will be able to do after mastering this chapter
8. **Practice Question Preview** — 3 example questions that will appear in the problem set (don't give answers)

Write at depth appropriate for genuine mastery, not surface familiarity. Be precise, not padded.`

    try {
      const result = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      })

      const content = (result.content[0] as { text: string }).text?.trim()

      if (content) {
        await prisma.chapter.update({
          where: { id: chapter.id },
          data: { content },
        })
        console.log(`  ✅ Generated (${content.length} chars)`)
      } else {
        console.log(`  ⚠️ Empty response`)
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err}`)
    }

    // Rate limit: 1 second delay between calls
    if (i < chapters.length - 1) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  console.log('\n✅ Done.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
