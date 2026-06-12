import prisma from '../src/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

const userId = '112140678888944825287'

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const client = new Anthropic({ apiKey })
  
  // Delete the fake hardcoded tracks
  await prisma.track.deleteMany({ where: { userId } })
  console.log('Cleared old tracks')
  
  // Update profile to onboarded
  await prisma.studentProfile.upsert({
    where: { userId },
    update: {
      interests: JSON.stringify(['Buddhist philosophy', 'Tibetan Buddhism', 'comparative religious studies', 'teaching', 'mindfulness']),
      aspirations: 'Create a comprehensive map of Buddhist knowledge and teach core concepts to help reduce suffering in daily life',
      isOnboarded: true,
    },
    create: {
      userId,
      learningStage: 3,
      xp: 0,
      streak: 0,
      interests: JSON.stringify(['Buddhist philosophy', 'Tibetan Buddhism', 'comparative religious studies']),
      aspirations: 'Create a comprehensive map of Buddhist knowledge and teach core concepts',
      isOnboarded: true,
    }
  })
  
  console.log('Generating curriculum for Bobby...')
  const result = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `Design a personalized curriculum for a contemplative scholar interested in Buddhist philosophy, Tibetan Buddhism, and comparative religious studies who wants to create a comprehensive map of Buddhist knowledge and teach core concepts to reduce suffering.

Return ONLY valid JSON (no markdown):
{"profileSummary":"1 sentence","tracks":[{"name":"Track Name","description":"short desc","color":"#hex","type":"project","chapters":[{"title":"Ch Title","description":"20 words","keyTopics":["t1","t2"],"estimatedMinutes":60,"content":"2 paragraph overview"}],"projectIdea":"1 sentence project"},{"name":"Foundation Track","description":"desc","color":"#10B981","type":"core","chapters":[{"title":"Ch Title","description":"20 words","keyTopics":["t1"],"estimatedMinutes":45,"content":"2 paragraph overview"}]}]}`
    }]
  })
  
  const text = (result.content[0] as any).text.trim()
  console.log('Response length:', text.length)
  const data = JSON.parse(text)
  console.log('Got', data.tracks.length, 'tracks')
  
  for (let i = 0; i < data.tracks.length; i++) {
    const t = data.tracks[i]
    const trackType = ['core', 'core-content', 'foundation'].includes(t.type) ? 'core' : 'project'
    const track = await prisma.track.create({
      data: { userId, name: t.name, description: t.description || '', color: t.color || '#8B5CF6', type: trackType, order: i }
    })
    console.log('  Track:', t.name, '(' + trackType + ')')
    for (let j = 0; j < (t.chapters || []).length; j++) {
      const ch = t.chapters[j]
      await prisma.chapter.create({
        data: {
          trackId: track.id,
          title: ch.title,
          description: ch.description || '',
          keyTopics: JSON.stringify(ch.keyTopics || []),
          estimatedMinutes: ch.estimatedMinutes || 60,
          content: ch.content || `# ${ch.title}\n\nContent to be generated.`,
          status: 'not-started',
          order: j,
        }
      })
    }
    if (t.projectIdea) {
      await prisma.subjectProject.create({
        data: { trackId: track.id, title: t.projectIdea.slice(0, 50), description: t.projectIdea, proposal: '', status: 'proposal', progress: 0, coverageMap: JSON.stringify((t.chapters||[]).map((c:any) => c.title)) }
      })
    }
  }
  
  await prisma.curriculumPlan.update({
    where: { userId },
    data: { profileSummary: data.profileSummary, primaryInterests: JSON.stringify(['Buddhist philosophy', 'Tibetan Buddhism', 'comparative religious studies']) }
  })
  
  console.log('\n✅ Bobby account fixed!')
  await prisma.$disconnect()
}

main().catch(console.error)
