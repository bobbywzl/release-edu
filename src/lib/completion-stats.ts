'use client'
import { useState, useEffect, useCallback } from 'react'

export interface TrackStat {
  trackId: string; trackName: string; trackType: string; trackColor: string;
  total: number; completed: number; inProgress: number; progress: number;
  status: string;
}

export interface CompletionStats {
  overall: { progress: number; completed: number; total: number; completedProjects: number; totalProjects: number; curriculumComplete: boolean };
  tracks: TrackStat[];
  interestTracks: TrackStat[];
  foundationTracks: TrackStat[];
  pendingChapters: { id: string; title: string; status: string; trackId: string; trackName: string }[];
  completedChapters: { id: string; title: string; status: string; trackId: string; trackName: string }[];
}

type Listener = () => void
const listeners: Set<Listener> = new Set()
export function refreshCompletionStats() { listeners.forEach(fn => fn()) }

// Global in-memory cache
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let _cache: { data: CompletionStats; fetchedAt: number } | null = null

export function useCompletionStats() {
  const [stats, setStats] = useState<CompletionStats | null>(_cache?.data ?? null)
  const [loading, setLoading] = useState(!_cache)

  const fetchData = useCallback(async (force = false) => {
    // Never serve cached empty results (e.g. from auth timing issues)
    if (!force && _cache && _cache.data.tracks.length > 0 && Date.now() - _cache.fetchedAt < CACHE_TTL) {
      setStats(_cache.data)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/user/completion-stats', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (json.tracks?.length > 0) {
          _cache = { data: json, fetchedAt: Date.now() }
        }
        setStats(json)
      }
    } catch {} finally { setLoading(false) }
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

  return { stats, loading, refresh: forceRefresh }
}
