/**
 * Fire-and-forget work that must SURVIVE the response ending.
 *
 * On Vercel serverless the runtime may freeze the instance the moment the
 * response (or stream) closes — plain un-awaited promises then silently never
 * finish, which was quietly starving the insight moat (extraction runs after
 * the stream closes) and stranding portfolio generation. waitUntil() keeps
 * the instance alive until the promise settles; outside Vercel (local dev)
 * it throws, and the promise simply keeps running on the live process.
 * Never blocks the user's response either way.
 */
import { waitUntil } from '@vercel/functions'

export function inBackground(work: Promise<unknown> | (() => Promise<unknown>)): void {
  const p = (typeof work === 'function' ? work() : work).catch(() => { /* non-critical */ })
  try { waitUntil(p) } catch { /* non-Vercel runtime — promise already running */ }
}
