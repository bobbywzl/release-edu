// One-shot scrub: strip ```problem blocks and capstone headers from existing
// assistant messages whose containing chapter has sessionScore < 80. These
// were emitted by Bob before the server-side capstone guardrail was added.
//
// Usage: npx tsx scripts/scrub-premature-capstone.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PROBLEM_BLOCK_RE = /```problem\n[\s\S]*?```/g
const CAPSTONE_HEADER_RE = /(?:^|\n)\s*(?:Capstone\s+Problem\s+Set|capstone threshold|you're at the capstone)[\s\S]*?(?=\n\n|$)/gi

async function main() {
  // Fetch all assistant messages containing a problem block. We'll cross-check
  // each one's chapter via the user's chapter session record.
  const candidates = await prisma.message.findMany({
    where: { role: 'assistant', content: { contains: '```problem' } },
    select: { id: true, content: true, conversationId: true, conversation: { select: { userId: true } } },
  })

  console.log(`Candidates with \`\`\`problem blocks: ${candidates.length}`)
  if (candidates.length === 0) {
    await prisma.$disconnect()
    return
  }

  // Build a per-user map of "any chapter currently below 80 score". If a user
  // has at least one < 80 chapter, we treat their pset-containing messages as
  // suspect. (We can't perfectly attribute a single message to a single
  // chapter without more linkage, but this is conservative — stripping a
  // wrongly-emitted capstone from a clearly under-threshold session.)
  const allChapters = await prisma.chapter.findMany({
    select: { sessionScore: true, track: { select: { userId: true } } },
  })
  const usersWithLowChapter = new Set<string>()
  for (const c of allChapters) {
    if ((c.sessionScore ?? 0) < 80 && c.track?.userId) usersWithLowChapter.add(c.track.userId)
  }

  let stripped = 0
  for (const m of candidates) {
    const uid = m.conversation?.userId
    if (!uid) continue
    if (!usersWithLowChapter.has(uid)) continue

    let cleaned = m.content.replace(PROBLEM_BLOCK_RE, '').replace(CAPSTONE_HEADER_RE, '').trim()
    if (cleaned.length < 80) {
      cleaned = "Let's keep building before the capstone — there are still concepts to nail down. What's the next thing you want to dig into?"
    }
    if (cleaned !== m.content) {
      await prisma.message.update({ where: { id: m.id }, data: { content: cleaned } })
      stripped++
    }
  }
  console.log(`Stripped: ${stripped}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
