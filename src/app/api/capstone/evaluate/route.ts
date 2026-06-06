export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/get-user-id'
import { evaluateSubmission } from '@/lib/gemini'

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') || ''

  let submissionText = ''
  let submissionBase64: string | null = null
  let mimeType: string | undefined
  let question = ''
  let expectations = ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    submissionText = (formData.get('text') as string) || ''
    question = (formData.get('question') as string) || ''
    expectations = (formData.get('expectations') as string) || ''
    const file = formData.get('file') as File | null
    if (file) {
      const buf = Buffer.from(await file.arrayBuffer())
      submissionBase64 = buf.toString('base64')
      mimeType = file.type || 'application/octet-stream'
    }
  } else {
    const body = await req.json()
    submissionText = body.text || ''
    question = body.question || ''
    expectations = body.expectations || ''
    if (body.fileBase64) {
      submissionBase64 = body.fileBase64
      mimeType = body.mimeType
    }
  }

  if (!question || !expectations) {
    return NextResponse.json({ error: 'Missing question or expectations' }, { status: 400 })
  }

  const result = await evaluateSubmission(submissionBase64, submissionText, expectations, question, mimeType)
  return NextResponse.json(result)
}
