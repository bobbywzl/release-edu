/**
 * Student Data Layer — Client-side hook
 * Fetches from /api/student-data which returns real DB data.
 * 
 * Uses a global event emitter so any component can trigger a refresh
 * (e.g., after Bob modifies the curriculum).
 */

'use client'
import { useState, useEffect, useCallback } from 'react'

// Empty/default state for immediate render (no mock data)
export function getStudentData() {
  return {
    student: {
      id: '',
      name: '',
      email: '',
      avatar: undefined as string | undefined,
      image: undefined as string | undefined,
      xp: 0,
      level: 1,
      streak: 0,
      stage: 'motivation' as const,
      joinedAt: new Date(),
    },
    knowledgeNodes: [] as Array<{
      id: string
      label: string
      subject: string
      status: string
      description?: string
      estimatedHours?: number
      resources: string[]
      prerequisites: string[]
    }>,
    projects: [] as Array<{
      id: string
      title: string
      description: string
      subject: 'CS' | 'Math' | 'Psychology' | 'Finance' | 'General'
      trackId?: string
      trackName?: string
      trackColor?: string
      dbStatus?: string
      status: 'active' | 'planning' | 'completed' | 'paused'
      progress: number
      tags: string[]
    }>,
    assignments: [] as Array<{
      id: string
      title: string
      subject: string
      description: string
      status: string
      competencies: string[]
    }>,
    curriculumPlan: {
      id: '',
      studentId: '',
      generatedAt: '',
      lastUpdatedAt: '',
      version: 1,
      profileSummary: '',
      primaryStrengths: [] as string[],
      primaryInterests: [] as string[],
      learningStyle: '',
      personalityTraits: [] as string[],
      tracks: [] as Array<{ id: string; name: string; description: string; color: string; modules: string[]; type?: string }>,
      projectModules: [] as Array<{ id: string; title: string; description: string; type: 'project' | 'core-content'; subject: string; trackId: string; status: 'not-started' | 'in-progress' | 'completed'; progress: number; estimatedHours: number; prerequisites: string[]; skills: string[]; aiRationale: string }>,
      coreModules: [] as Array<{ id: string; title: string; description: string; type: 'project' | 'core-content'; subject: string; trackId: string; status: 'not-started' | 'in-progress' | 'completed'; progress: number; estimatedHours: number; prerequisites: string[]; skills: string[]; aiRationale: string }>,
    },
    projectModules: [] as Array<{ id: string; title: string; description: string; type: 'project' | 'core-content'; subject: string; trackId: string; status: 'not-started' | 'in-progress' | 'completed'; progress: number; estimatedHours: number; prerequisites: string[]; skills: string[]; aiRationale: string }>,
    coreModules: [] as Array<{ id: string; title: string; description: string; type: 'project' | 'core-content'; subject: string; trackId: string; status: 'not-started' | 'in-progress' | 'completed'; progress: number; estimatedHours: number; prerequisites: string[]; skills: string[]; aiRationale: string }>,
    tracks: [] as Array<{ id: string; name: string; description: string; color: string; modules: string[]; type?: string }>,
    insights: [] as Array<{ id: string; studentId: string; type: 'personality' | 'interest' | 'strength' | 'weakness' | 'preference' | 'aspiration' | 'breakthrough' | 'struggle' | 'style'; content: string; confidence: number; source: string; createdAt: string }>,
    isOnboarded: false,
    hasSetupProfile: false,
    hasCurriculum: false,
    manualRegenerationCount: 0,
    manualRegenerationLimit: 2,
  }
}

const REFRESH_EVENT = 'student-data-refresh'

// Optimistic override — only used between save click and API response arriving
let _displayNameOverride: string | null = null

export function setDisplayName(name: string) {
  _displayNameOverride = name
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
  }
}
export function getDisplayNameOverride() { return _displayNameOverride }

/**
 * Call this from anywhere to trigger all useStudentData hooks to re-fetch.
 * IMPORTANT: this also drops the in-memory cache so the next mount of any
 * useStudentData hook (including a fresh page after navigation) doesn't
 * short-circuit to stale data. The redirect war after Start Over was caused
 * exactly by that — the cache held isOnboarded:true with old tracks, so when
 * the onboarding page mounted, its redirect-back guard fired against the
 * cached state and bounced the user to /dashboard/curriculum.
 */
export function refreshStudentData() {
  _cache = null
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
  }
}

// Global in-memory cache — shared across all hook instances and page navigations
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let _cache: { data: ReturnType<typeof getStudentData>; fetchedAt: number } | null = null

// Async hook that fetches real data and auto-refreshes on curriculum changes.
export function useStudentData(): { data: ReturnType<typeof getStudentData>; loading: boolean; refresh: () => void } {
  const [data, setData] = useState(_cache?.data ?? getStudentData())
  const [loading, setLoading] = useState(!_cache)

  const fetchData = useCallback(async (force = false) => {
    // Serve from cache if fresh enough (never cache empty/unauthenticated results)
    if (!force && _cache && _cache.data.isOnboarded && Date.now() - _cache.fetchedAt < CACHE_TTL) {
      const cached = _cache.data
      if (_displayNameOverride && cached.student) {
        cached.student.name = _displayNameOverride
      }
      setData(cached)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/student-data', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (_displayNameOverride && json.student) {
          json.student.name = _displayNameOverride
        }
        // Only cache if we got real data (authenticated + onboarded)
        if (json.isOnboarded) {
          _cache = { data: json, fetchedAt: Date.now() }
        }
        setData(json)
      }
    } catch {
      // Keep current state
    } finally {
      setLoading(false)
    }
  }, [])

  const forceRefresh = useCallback(() => fetchData(true), [fetchData])

  useEffect(() => {
    fetchData()

    // Listen for refresh events (profile save, curriculum updates, etc.) — these force-fetch
    const onRefresh = () => fetchData(true)
    window.addEventListener(REFRESH_EVENT, onRefresh)
    window.addEventListener('curriculum-updated', onRefresh)

    // Background refresh every 5 minutes
    const interval = setInterval(() => fetchData(true), CACHE_TTL)

    return () => {
      window.removeEventListener(REFRESH_EVENT, onRefresh)
      window.removeEventListener('curriculum-updated', onRefresh)
      clearInterval(interval)
    }
  }, [fetchData])

  return { data, loading, refresh: forceRefresh }
}
