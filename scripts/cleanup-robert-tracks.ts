import prisma from '../src/lib/prisma'

const userId = '112687603494389110485'

async function main() {
  console.log('=== Robert\'s Current Tracks ===\n')

  const tracks = await prisma.track.findMany({
    where: { userId },
    include: {
      chapters: { select: { id: true, title: true, status: true }, orderBy: { order: 'asc' } },
      homeworks: { select: { id: true } },
      quizzes: { select: { id: true } },
    },
    orderBy: [{ createdAt: 'asc' }],
  })

  for (const t of tracks) {
    const completedChapters = t.chapters.filter(c => c.status === 'completed').length
    console.log(`[${t.id}] "${t.name}" (type: ${t.type}, order: ${t.order})`)
    console.log(`   ${t.chapters.length} chapters (${completedChapters} completed), ${t.homeworks.length} hw, ${t.quizzes.length} quizzes`)
    console.log(`   Created: ${t.createdAt.toISOString()}`)
  }
  console.log(`\nTotal: ${tracks.length} tracks\n`)

  // Strategy: We have 3 generations:
  // Gen 1 (19:39): Quantum Foundations, Cryptography & Quantum Security, API Dev & SW Eng, Quantum Platform Integration (3 ch each)
  // Gen 2 (19:52): Linear Algebra & Mathematics, Computer Science Fundamentals (3 ch each) — foundation tracks added later
  // Gen 3 (21:07): Mathematics for Cryptography (Foundation) (6 ch), Computer Science for Cryptography (Foundation) (6 ch) — better foundations
  // Gen 4 (21:18): Quantum Cryptography & Security, API Platform Dev, Applied Crypto & Blockchain, Math for Quantum Computing, Tech Writing — all EMPTY (0 chapters)
  //
  // Best plan: Keep Gen 1 interest tracks (they have chapters), keep Gen 3 foundations (6 chapters each, better than Gen 2's 3).
  // Delete: Gen 2 foundations (superseded by Gen 3), Gen 4 empty tracks (failed creates that duplicated intent).

  // IDs to delete:
  const toDelete: { id: string; name: string; reason: string }[] = []

  for (const t of tracks) {
    // Delete Gen 2 foundations — superseded by Gen 3's better versions
    if (t.name === 'Linear Algebra & Mathematics' || t.name === 'Computer Science Fundamentals') {
      toDelete.push({ id: t.id, name: t.name, reason: 'superseded by Gen 3 foundations with 6 chapters' })
      continue
    }

    // Delete all empty (0 chapter) tracks — they're failed/partial creates from Gen 4
    if (t.chapters.length === 0) {
      toDelete.push({ id: t.id, name: t.name, reason: 'empty (0 chapters) — failed/partial create' })
      continue
    }
  }

  if (toDelete.length === 0) {
    console.log('✅ Nothing to clean up!')
  } else {
    console.log(`🗑️  Deleting ${toDelete.length} tracks:\n`)
    for (const { id, name, reason } of toDelete) {
      console.log(`  Deleting "${name}" — ${reason}`)
      await prisma.track.delete({ where: { id } })
    }

    // Re-order remaining tracks
    const remaining = await prisma.track.findMany({
      where: { userId },
      include: { chapters: { select: { id: true } } },
      orderBy: [{ type: 'desc' }, { createdAt: 'asc' }], // project first, then core
    })

    console.log(`\n📋 Re-ordering ${remaining.length} remaining tracks...\n`)
    for (let i = 0; i < remaining.length; i++) {
      await prisma.track.update({
        where: { id: remaining[i].id },
        data: { order: i },
      })
      console.log(`  [${i}] "${remaining[i].name}" (${remaining[i].type}, ${remaining[i].chapters.length} chapters)`)
    }

    console.log('\n✅ Cleanup complete!')
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
