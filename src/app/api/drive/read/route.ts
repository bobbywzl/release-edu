import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const accessToken = token?.accessToken as string | undefined

  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { fileId, mimeType, fileName } = await req.json()

  try {
    let content: string

    if (mimeType?.includes('google-apps.document') || mimeType?.includes('google-apps.spreadsheet') || mimeType?.includes('google-apps.presentation')) {
      const exportMime = mimeType.includes('spreadsheet') ? 'text/csv' : 'text/plain'
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res.ok) throw new Error('Export failed')
      content = await res.text()
    } else if (mimeType?.includes('text') || mimeType?.includes('json') || mimeType?.includes('csv')) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res.ok) throw new Error('Download failed')
      content = await res.text()
    } else if (mimeType?.includes('pdf')) {
      content = `[PDF file: ${fileName}. To read PDF content, the file would need to be parsed with a PDF library. File ID: ${fileId}]`
    } else {
      content = `[Binary file: ${fileName}. Content extraction not supported for ${mimeType}. File ID: ${fileId}]`
    }

    return NextResponse.json({ content, fileName, mimeType })
  } catch (error) {
    console.error('Drive read error:', error)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}
