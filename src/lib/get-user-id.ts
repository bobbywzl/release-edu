import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function getUserId(): Promise<string> {
  // Demo cookie takes priority — allows logged-in users to enter demo mode
  const cookieStore = await cookies()
  const demoId = cookieStore.get('demo-session-id')?.value
  if (cookieStore.get('demo-mode')?.value === 'true' && demoId) {
    return `demo-${demoId}`
  }

  const session = await getServerSession(authOptions)
  if (session?.user) {
    return (session.user as { id?: string }).id || session.user.email || 'unknown'
  }
  return 'anonymous'
}

export async function getUserInfo(): Promise<{ id: string; email?: string; name?: string; image?: string }> {
  // Demo cookie takes priority
  const cookieStore = await cookies()
  const demoId = cookieStore.get('demo-session-id')?.value
  if (cookieStore.get('demo-mode')?.value === 'true' && demoId) {
    return { id: `demo-${demoId}`, email: `demo-${demoId}@release.edu`, name: 'Demo Student' }
  }

  const session = await getServerSession(authOptions)
  if (session?.user) {
    return {
      id: (session.user as { id?: string }).id || session.user.email || 'unknown',
      email: session.user.email || undefined,
      name: session.user.name || undefined,
      image: (session.user as { image?: string }).image || undefined,
    }
  }
  return { id: 'anonymous' }
}
