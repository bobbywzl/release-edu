import { PrismaClient } from '@prisma/client'

/**
 * Serverless + Supabase pooler tuning. Each Vercel function instance opens a
 * Prisma pool of num_cpus*2+1 connections by default; multiplied across
 * concurrent instances this exhausts Supabase's session-mode pooler
 * ("EMAXCONNSESSION: max clients reached") and then Prisma's own pool
 * ("Timed out fetching a new connection... connection limit: 5").
 *
 * On Vercel, pin each instance to ONE connection (queries within a request
 * queue on it — fine for short queries) and raise the in-process pool wait
 * above the 10s default. Local dev keeps Prisma defaults. The URL params are
 * only added when not already present, so an explicitly tuned DATABASE_URL
 * wins.
 */
function tunedDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL
  if (!raw || !process.env.VERCEL) return raw
  try {
    const url = new URL(raw)
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1')
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '30')
    return url.toString()
  } catch {
    return raw
  }
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const dbUrl = tunedDatabaseUrl()

const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
