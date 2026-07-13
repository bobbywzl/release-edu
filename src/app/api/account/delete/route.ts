import { NextResponse } from 'next/server'
import { dbStore } from '@/lib/db-store'
import { getUserId } from '@/lib/get-user-id'

export async function DELETE(request: Request) {
  try {
    const body = await request.json()

    if (body.confirmation !== 'DELETE MY ACCOUNT') {
      return NextResponse.json({ error: 'Invalid confirmation' }, { status: 400 })
    }

    const userId = await getUserId()
    const store = dbStore.forUser(userId)

    // Delete all user data from DB
    await store.deleteAllData()

    return NextResponse.json({ success: true, message: 'Account deleted' })
  } catch {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
