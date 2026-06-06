import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
  const accessToken = token?.accessToken as string | undefined

  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated with Google' }, { status: 401 })
  }

  const searchParams = req.nextUrl.searchParams
  const query = searchParams.get('q') || ''
  const pageToken = searchParams.get('pageToken') || ''

  try {
    let driveQuery = "trashed=false"
    if (query) {
      driveQuery += ` and name contains '${query.replace(/'/g, "\\'")}'`
    }
    driveQuery += " and (mimeType contains 'document' or mimeType contains 'spreadsheet' or mimeType contains 'presentation' or mimeType contains 'pdf' or mimeType contains 'text' or mimeType contains 'image')"

    const url = new URL('https://www.googleapis.com/drive/v3/files')
    url.searchParams.set('q', driveQuery)
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,thumbnailLink),nextPageToken')
    url.searchParams.set('orderBy', 'modifiedTime desc')
    url.searchParams.set('pageSize', '20')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const err = await res.json()
      console.error('Drive API error:', err)
      return NextResponse.json({ error: 'Failed to list Drive files' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Drive list error:', error)
    return NextResponse.json({ error: 'Drive API error' }, { status: 500 })
  }
}
