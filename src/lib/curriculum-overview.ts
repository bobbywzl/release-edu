'use client'
import { useState, useEffect, useCallback } from 'react'

export interface TrackOverview {
  id: string
  name: string
  description?: string
  color: string
  type: string
  order: number
  chapters: { id: string; title: string; status: string; estimatedMinutes: number; sessionScore?: number | null }[]
  homeworkCount: number
  completedHomeworkCount: number
  quizCount: number
  completedQuizCount: number
  projectStatus: string | null
}

type Listener = () => void
const listeners: Set<Listener> = new Set()

export function refreshCurriculumOverview() {
  listeners.forEach(fn => fn())
}

// Global in-memory cache
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let _cache: { data: TrackOverview[]; fetchedAt: number } | null = null

export function useCurriculumOverview() {
  const [tracks, setTracks] = useState<TrackOverview[]>(_cache?.data ?? [])
  const [loading, setLoading] = useState(!_cache)

  const fetchData = useCallback(async (force = false) => {
    if (!force && _cache && _cache.data.length > 0 && Date.now() - _cache.fetchedAt < CACHE_TTL) {
      setTracks(_cache.data)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/curriculum-overview', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()).tracks
        // Only cache non-empty results to avoid caching auth/timing failures
        if (data.length > 0) {
          _cache = { data, fetchedAt: Date.now() }
        }
        setTracks(data)
      }
    } catch {
      // keep current state
    } finally {
      setLoading(false)
    }
  }, [])

  const forceRefresh = useCallback(() => fetchData(true), [fetchData])

  useEffect(() => {
    fetchData()
    listeners.add(forceRefresh)
    const onUpdate = () => fetchData(true)
    window.addEventListener('curriculum-updated', onUpdate)
    const interval = setInterval(() => fetchData(true), CACHE_TTL)
    return () => {
      listeners.delete(forceRefresh)
      window.removeEventListener('curriculum-updated', onUpdate)
      clearInterval(interval)
    }
  }, [fetchData, forceRefresh])

  return { tracks, loading, refresh: forceRefresh }
}
