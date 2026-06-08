import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { adminApiGuard } from '@/lib/admin-auth'

export async function GET() {
  const denied = await adminApiGuard(); if (denied) return denied
  try {
    const users = await prisma.user.findMany({
      include: {
        studentProfile: true,
        conversations: {
          select: {
            id: true,
            title: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
        },
        _count: {
          select: { conversations: true, insights: true, tracks: true },
        },
        tracks: {
          select: { id: true, name: true, color: true },
        },
        curriculumPlan: {
          select: { id: true, version: true, generatedAt: true, lockedAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Admin users API error:', error)
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}
