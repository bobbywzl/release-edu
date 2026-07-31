import { NextResponse } from 'next/server'
import { getSlotAwareSession } from '@/lib/session-slots'

export async function GET() {
  const session = await getSlotAwareSession()

  // Return connected accounts based on current auth state
  const accounts = []

  if (session?.user?.email) {
    accounts.push({
      provider: 'google',
      email: session.user.email,
      primary: true,
    })
  }

  return NextResponse.json({ accounts })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, provider } = body

    if (action === 'connect') {
      // TODO: Initiate OAuth flow for the provider
      return NextResponse.json({
        success: true,
        email: `connected-${provider}@example.com`,
      })
    }

    if (action === 'disconnect') {
      // TODO: Disconnect the provider
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Failed to manage accounts' }, { status: 500 })
  }
}
