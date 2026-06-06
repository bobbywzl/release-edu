/**
 * File upload route — persists all files to DB (LinkedFile) for permanent storage.
 * Supports both FormData (binary files) and JSON (text content).
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getUserId } from '@/lib/get-user-id'

// GET /api/files/upload?workType=project&workId=xxx — load files for a work item
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  const { searchParams } = req.nextUrl
  const workType = searchParams.get('workType')
  const workId = searchParams.get('workId')

  if (!workId) return NextResponse.json({ files: [] })

  const files = await prisma.linkedFile.findMany({
    where: { userId, workType: workType || undefined, workId },
    orderBy: { addedAt: 'desc' },
  })

  return NextResponse.json({ files })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  const contentType = req.headers.get('content-type') || ''

  // ── JSON body: text content save ──────────────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json()
    const { workType, workId, trackId, name, type, content } = body as {
      workType?: string
      workId?: string
      trackId?: string
      name?: string
      type?: string
      content?: string
    }

    if (!content || !name) {
      return NextResponse.json({ error: 'Missing content or name' }, { status: 400 })
    }

    const mimeType = type || 'text/markdown'
    const sizeBytes = Buffer.byteLength(content, 'utf-8')

    // Store content directly in DB as text
    const record = await prisma.linkedFile.create({
      data: {
        userId,
        trackId: trackId || null,
        workType: workType || 'content',
        workId: workId || null,
        name: name,
        mimeType,
        content,
        size: sizeBytes,
        url: null,
      },
    })

    return NextResponse.json({
      id: record.id,
      name: record.name,
      type: mimeType,
      size: sizeBytes,
      url: null,
      addedAt: record.addedAt.toISOString(),
      workType,
      workId,
      trackId,
    })
  }

  // ── FormData body: binary/text file upload ────────────────────────────────
  const formData = await req.formData()
  const file = formData.get('file') as File
  const workType = formData.get('workType') as string
  const workId = formData.get('workId') as string
  const trackId = formData.get('trackId') as string

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const mimeType = file.type || 'application/octet-stream'
  const isText = mimeType.startsWith('text/') ||
    /\.(md|txt|py|js|ts|jsx|tsx|html|css|json|csv|yaml|yml|xml|sh|rb|go|rs|java|cpp|c|h)$/i.test(file.name)
  const isImage = mimeType.startsWith('image/')

  let content: string | null = null

  if (isText) {
    content = await file.text()
  } else if (isImage) {
    // Store images as base64 data URI
    const buf = await file.arrayBuffer()
    const b64 = Buffer.from(buf).toString('base64')
    content = `data:${mimeType};base64,${b64}`
  } else {
    // For PDFs and other binary files, store a placeholder
    content = `[Binary file: ${file.name} (${mimeType}, ${(file.size / 1024).toFixed(1)} KB)]`
  }

  const record = await prisma.linkedFile.create({
    data: {
      userId,
      trackId: trackId || null,
      workType: workType || null,
      workId: workId || null,
      name: file.name,
      mimeType,
      content,
      size: file.size,
      url: null,
    },
  })

  return NextResponse.json({
    id: record.id,
    name: record.name,
    type: mimeType,
    size: file.size,
    url: isImage ? content : null, // return data URI for images so they can display
    addedAt: record.addedAt.toISOString(),
    workType,
    workId,
    trackId,
  })
}

// DELETE /api/files/upload?id=xxx
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const existing = await prisma.linkedFile.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.linkedFile.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
