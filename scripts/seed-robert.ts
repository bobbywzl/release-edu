import prisma from '../src/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

const userId = '112687603494389110485'

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const client = new Anthropic({ apiKey })
  
  console.log('Generating personalized curriculum for Robert Wu...')
  const result = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `Design 4 personalized learning tracks for a 16-year-old passionate about quantum computing and cybersecurity who wants to build a quantum algorithm API platform.

Return ONLY valid JSON (no markdown, no backticks):
{"profileSummary":"1 sentence summary","tracks":[{"name":"Track Name","description":"short desc","color":"#6366f1","chapters":[{"title":"Ch Title","description":"20 words","keyTopics":["t1","t2"],"estimatedMinutes":45,"content":"1 short paragraph overview"}],"projectIdea":"Project idea in 1 sentence"}]}`
    }]
  })
  
  const text = (result.content[0] as any).text.trim()
  console.log('Raw response length:', text.length, 'chars')
  // Strip backtick fences if present
  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const data = JSON.parse(clean)
  console.log('Parsed', data.tracks.length, 'tracks')
  
  // Clear old tracks
  await prisma.track.deleteMany({ where: { userId } })
  
  for (let i = 0; i < data.tracks.length; i++) {
    const t = data.tracks[i]
    const track = await prisma.track.create({
      data: { userId, name: t.name, description: t.description || '', color: t.color || '#6366f1', type: 'project', order: i }
    })
    console.log('  Track created:', t.name)
    
    for (let j = 0; j < (t.chapters || []).length; j++) {
      const ch = t.chapters[j]
      await prisma.chapter.create({
        data: {
          trackId: track.id,
          title: ch.title,
          description: ch.description || '',
          keyTopics: JSON.stringify(ch.keyTopics || []),
          estimatedMinutes: ch.estimatedMinutes || 45,
          content: ch.content || `# ${ch.title}\n\nContent for this chapter.`,
          status: 'not-started',
          order: j
        }
      })
    }
    
    if (t.projectIdea) {
      await prisma.subjectProject.create({
        data: {
          trackId: track.id,
          title: t.projectIdea.slice(0, 50),
          description: t.projectIdea,
          proposal: '',
          status: 'proposal',
          progress: 0,
          coverageMap: JSON.stringify((t.chapters || []).map((c: any) => c.title))
        }
      })
    }
  }
  
  // Update profile
  await prisma.studentProfile.update({
    where: { userId },
    data: {
      interests: JSON.stringify(['quantum computing', 'cybersecurity', 'cryptography', 'API development', 'algorithms']),
      aspirations: 'Build a quantum algorithm API platform for cybersecurity companies',
      isOnboarded: true
    }
  })
  
  // Update curriculum plan
  await prisma.curriculumPlan.update({
    where: { userId },
    data: {
      profileSummary: data.profileSummary,
      primaryInterests: JSON.stringify(['quantum computing', 'cybersecurity', 'cryptography']),
      primaryStrengths: JSON.stringify(['analytical thinking', 'systems design', 'mathematical reasoning'])
    }
  })
  
  console.log('\n✅ Robert Wu curriculum generated successfully!')
  console.log('Tracks created:', data.tracks.map((t: any) => t.name).join(', '))
}

main().catch(console.error).finally(() => prisma.$disconnect())
