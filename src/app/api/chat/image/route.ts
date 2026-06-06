import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'
import { analyzeImage } from '@/lib/gemini'
import { buildSystemPrompt, DEFAULT_TEACHER_CONFIG } from '@/lib/system-prompt'
import { getStudentContext } from '@/lib/student-context'

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const isDemo = cookieStore.get('demo-mode')?.value === 'true'
  const session = await getServerSession(authOptions)

  if (!session?.user && !isDemo) {
    return new Response('Unauthorized', { status: 401 })
  }

  const storeUserId = await getUserId()
  const store = dbStore.forUser(storeUserId)

  // Parse multipart form data
  let fileBase64 = ''
  let fileMimeType = 'image/jpeg'
  let userMessage = ''
  let conversationId: string | undefined

  try {
    const formData = await req.formData()
    const imageFile = formData.get('image') as File | null
    userMessage = (formData.get('message') as string) ?? ''
    conversationId = (formData.get('conversationId') as string) ?? undefined

    if (imageFile) {
      const buffer = await imageFile.arrayBuffer()
      fileBase64 = Buffer.from(buffer).toString('base64')
      fileMimeType = imageFile.type || 'image/jpeg'
    }
  } catch {
    return new Response('Invalid form data', { status: 400 })
  }

  if (!fileBase64) {
    return new Response('File required', { status: 400 })
  }

  const isVideo = fileMimeType.startsWith('video/')
  const isPDF = fileMimeType === 'application/pdf'

  // Analyze with Gemini (handles images, videos, PDFs)
  const imageAnalysis = await analyzeImage(
    fileBase64,
    userMessage || 'educational context',
    fileMimeType
  )
  const imageBase64 = fileBase64 // alias for backward compat below

  // Set up conversation
  if (!conversationId) {
    const newConv = await store.createConversation('Image Analysis')
    conversationId = newConv.id
  }
  // Save user message
  await store.addMessage(conversationId, 'user', userMessage || '[Image uploaded]')

  const apiKey = process.env.ANTHROPIC_API_KEY
  const encoder = new TextEncoder()
  const finalConvId = conversationId

  // Build combined message for Claude
  const combinedMessage = `[Student uploaded an image]

**Image Analysis (Gemini):**
${imageAnalysis}

${userMessage ? `**Student's message:** ${userMessage}` : '**Student sent an image without a message.**'}

Please respond as Bob, the AI mentor. Reference what you see in the image and help the student learn from it.`

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''

      if (!apiKey) {
        const mock = "That's a great image to share! Let me look at what you've sent... Based on what I can see, I'd love to understand what you're trying to figure out. What specific aspect of this would you like to explore together?"
        const words = mock.split(' ')
        for (const word of words) {
          fullResponse += word + ' '
          controller.enqueue(encoder.encode(word + ' '))
          await new Promise(r => setTimeout(r, 35))
        }
      } else {
        try {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const client = new Anthropic({ apiKey })

          const studentContext = await getStudentContext(null, true, storeUserId)
          const teacherConfig = await store.getMentorConfig() ?? DEFAULT_TEACHER_CONFIG
          const systemPrompt = buildSystemPrompt(studentContext, teacherConfig as any)

          // Get recent conversation history
          let history: { role: 'user' | 'assistant'; content: string }[] = []
          if (conversationId) {
            const conv = await store.getConversation(conversationId)
            history = (conv?.messages ?? [])
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .slice(-10)
              .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          }

          // Build user content — Claude can handle images but NOT video/PDF directly
          const userContent: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = []
          
          const claudeSupportedImage = fileMimeType.startsWith('image/') && !isPDF && !isVideo
          const mediaType = claudeSupportedImage
            ? (fileMimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
            : 'image/jpeg'

          if (claudeSupportedImage) {
            // Send image directly to Claude with vision
            userContent.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            })
          }

          // Add text context — for video/PDF, rely entirely on Gemini analysis
          const fileLabel = isVideo ? 'video' : isPDF ? 'PDF document' : 'image'
          userContent.push({
            type: 'text',
            text: claudeSupportedImage
              ? (userMessage
                  ? `${userMessage}\n\n(Gemini's analysis of this image: ${imageAnalysis.slice(0, 500)})`
                  : `The student uploaded this image. Describe what you see and help them learn from it.\n\n(Gemini analysis: ${imageAnalysis.slice(0, 500)})`)
              : (userMessage
                  ? `The student uploaded a ${fileLabel} and says: "${userMessage}"\n\nGemini's analysis of the ${fileLabel}:\n${imageAnalysis}\n\nPlease help the student based on this analysis.`
                  : `The student uploaded a ${fileLabel}. Here is Gemini's analysis of it:\n\n${imageAnalysis}\n\nPlease discuss this content with the student and help them learn from it.`),
          })

          const response = await client.messages.stream({
            model: 'claude-opus-4-8',
            max_tokens: 2048,
            system: systemPrompt,
            messages: [
              ...history.slice(0, -1),
              { role: 'user', content: userContent as any },
            ],
          })

          for await (const chunk of response) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              fullResponse += chunk.delta.text
              controller.enqueue(encoder.encode(chunk.delta.text))
            }
          }
        } catch (err) {
          console.error('Chat image API error:', err)
          const errMsg = "I'm having trouble processing that image right now. Could you describe what you're looking at instead?"
          fullResponse = errMsg
          controller.enqueue(encoder.encode(errMsg))
        }
      }

      // Save assistant response
      await store.addMessage(finalConvId, 'assistant', fullResponse.trim())

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Conversation-Id': finalConvId,
      'X-Image-Analysis': imageAnalysis.slice(0, 200).replace(/\n/g, ' '),
    },
  })
}
