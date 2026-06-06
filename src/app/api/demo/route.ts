import { NextResponse } from 'next/server'
import crypto from 'crypto'

export async function POST() {
  // Generate a unique session ID for this demo visitor (no DB record created)
  const sessionId = crypto.randomBytes(8).toString('hex')

  const response = NextResponse.json({ success: true, sessionId })
  response.cookies.set('demo-mode', 'true', {
    httpOnly: false, // readable by client JS for UI state (e.g. "Exit Demo" button)
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
    sameSite: 'lax',
  })
  response.cookies.set('demo-session-id', sessionId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
