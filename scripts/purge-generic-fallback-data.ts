/**
 * One-shot DB cleanup: remove curriculum chapters and inspiration projects
 * whose titles exactly match the old hardcoded fallback template. Anything
 * the user generated since the prompt fixes (specific titles) is preserved.
 *
 * Run: npx tsx scripts/purge-generic-fallback-data.ts
 *
 * After running, regenerate the curriculum via Bob/onboarding to get fresh
 * Claude-produced specific chapters.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true })

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Exact chapter titles from the old generateDefaultCurriculum fallback.
const FALLBACK_CHAPTER_TITLES = [
  'Foundations and Vocabulary',
  'Core Principles',
  'First Hands-on Project',
  'First Hands-On Project',
  'Tools and Techniques',
  'Real-World Applications',
  'End-to-End System Project',
  'Advanced Topics',
  'Professional Practice',
  'Capstone Project',
]

// Exact inspiration project titles from the old fallback.
const FALLBACK_INSPIRATION_TITLE_PREFIXES = [
  'Build: A starter project that demonstrates the core ideas of',
  'Build: A practical project that solves a real problem using',
  'Build: A capstone project showcasing your mastery',
]

async function main() {
  // 1. Count what we're about to delete
  const chapters = await prisma.chapter.findMany({
    where: { title: { in: FALLBACK_CHAPTER_TITLES } },
    select: { id: true, title: true, trackId: true },
  })
  console.log(`Found ${chapters.length} fallback-template chapters`)
  for (const c of chapters) console.log(`  - "${c.title}" (chapter ${c.id} in track ${c.trackId})`)

  const inspirations = await prisma.subjectProject.findMany({
    where: {
      status: 'planning',
      OR: FALLBACK_INSPIRATION_TITLE_PREFIXES.map(prefix => ({ title: { startsWith: prefix } })),
    },
    select: { id: true, title: true, trackId: true },
  })
  console.log(`\nFound ${inspirations.length} fallback-template project inspirations`)
  for (const p of inspirations) console.log(`  - "${p.title}" (project ${p.id})`)

  if (chapters.length === 0 && inspirations.length === 0) {
    console.log('\nNothing to clean up.')
    return
  }

  // 2. Delete
  const chDeleted = await prisma.chapter.deleteMany({
    where: { title: { in: FALLBACK_CHAPTER_TITLES } },
  })
  console.log(`\nDeleted ${chDeleted.count} chapters`)

  const projDeleted = await prisma.subjectProject.deleteMany({
    where: {
      status: 'planning',
      OR: FALLBACK_INSPIRATION_TITLE_PREFIXES.map(prefix => ({ title: { startsWith: prefix } })),
    },
  })
  console.log(`Deleted ${projDeleted.count} inspiration projects`)

  // 3. Recompute track progress (some tracks may now have zero chapters)
  const affectedTrackIds = Array.from(new Set(chapters.map(c => c.trackId)))
  for (const trackId of affectedTrackIds) {
    const remaining = await prisma.chapter.count({ where: { trackId } })
    if (remaining === 0) {
      await prisma.track.update({
        where: { id: trackId },
        data: { progress: 0, trackStatus: 'not-started' },
      })
    }
  }
  console.log(`\nReset progress on ${affectedTrackIds.length} tracks that lost all chapters`)
  console.log('\nDone. Regenerate curricula via Bob/onboarding to get specific Claude-produced chapters.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
}).finally(() => prisma.$disconnect())
