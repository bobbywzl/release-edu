import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function POST(req: NextRequest) {
  const { fileUrl, fileName } = await req.json()

  const filePath = path.join(process.cwd(), 'public', fileUrl)

  try {
    let content: string
    const ext = path.extname(fileName).toLowerCase()

    if (['.txt', '.md', '.csv'].includes(ext)) {
      content = await readFile(filePath, 'utf-8')
    } else if (ext === '.pdf') {
      const buffer = await readFile(filePath)
      content = `[PDF file: ${fileName}, ${buffer.length} bytes. Full PDF parsing requires pdf-parse library.]`
    } else {
      content = `[File: ${fileName}. Binary file — content extraction not supported for this type.]`
    }

    return NextResponse.json({ content, fileName, type: ext })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
