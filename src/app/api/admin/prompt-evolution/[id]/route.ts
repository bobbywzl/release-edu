export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'

async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies()
  return cookieStore.get('admin-auth')?.value === 'true'
}

// PATCH { action: 'approve' | 'reject' }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()
  const { action } = body as { action: 'approve' | 'reject' }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const proposal = await prisma.promptEvolutionProposal.findUnique({
    where: { id },
  })

  if (!proposal) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal already reviewed' }, { status: 400 })
  }

  const updated = await prisma.promptEvolutionProposal.update({
    where: { id },
    data: {
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedBy: 'admin',
      reviewedAt: new Date(),
      ...(action === 'approve' ? { appliedAt: new Date() } : {}),
    },
  })

  return NextResponse.json({ proposal: updated })
}
