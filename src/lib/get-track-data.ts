/**
 * @deprecated Use `useWorkData` from `@/lib/work-data` for per-user isolated data.
 * This file reads from static demo data and does NOT reflect per-user changes.
 * Kept only for backward compatibility — do NOT use in new code.
 */
import { demoSyllabi, demoHomework, demoQuizzes, demoProjects } from './demo-work-data'

export function getTrackSyllabus(trackId: string) { return demoSyllabi[trackId] ?? null }
export function getTrackHomework(trackId: string) { return demoHomework[trackId] ?? [] }
export function getTrackQuizzes(trackId: string) { return demoQuizzes[trackId] ?? [] }
export function getTrackProject(trackId: string) { return demoProjects[trackId] ?? null }
