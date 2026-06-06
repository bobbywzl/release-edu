'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SubjectSyllabus, Homework, Quiz, SubjectProject } from '@/types'

interface TrackWorkData {
  syllabus: SubjectSyllabus | null
  homework: Homework[]
  quizzes: Quiz[]
  project: SubjectProject | null
}

// Global refresh listeners
type Listener = () => void
const listeners: Set<Listener> = new Set()

/** Call this from anywhere to trigger all useWorkData hooks to re-fetch */
export function refreshWorkData() {
  listeners.forEach(fn => fn())
}

export function useWorkData(trackId: string): { data: TrackWorkData; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<TrackWorkData>({
    syllabus: null,
    homework: [],
    quizzes: [],
    project: null,
  })
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/work-data?trackId=${encodeURIComponent(trackId)}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch {
      // Keep empty state
    } finally {
      setLoading(false)
    }
  }, [trackId])

  useEffect(() => {
    fetchData()
    listeners.add(fetchData)
    return () => { listeners.delete(fetchData) }
  }, [fetchData])

  return { data, loading, refresh: fetchData }
}
