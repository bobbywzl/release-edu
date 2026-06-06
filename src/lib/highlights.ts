'use client'
import { useState, useEffect, useCallback } from 'react'

export interface Highlight {
  id: string
  messageId: string
  selectedText: string
  startOffset: number
  endOffset: number
  comment: string | null
  color: string
  createdAt: string
}

export function useHighlights(conversationId: string | null) {
  const [highlights, setHighlights] = useState<Highlight[]>([])

  const load = useCallback(async () => {
    if (!conversationId) return
    const res = await fetch(`/api/highlights?conversationId=${conversationId}`)
    if (res.ok) setHighlights((await res.json()).highlights)
  }, [conversationId])

  useEffect(() => { load() }, [load])

  async function addHighlight(data: Omit<Highlight, 'id' | 'createdAt'>) {
    const res = await fetch('/api/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, conversationId }),
    })
    if (res.ok) {
      const { highlight } = await res.json()
      setHighlights(prev => [...prev, highlight])
      return highlight
    }
  }

  async function updateHighlight(id: string, data: { comment?: string; color?: string }) {
    await fetch(`/api/highlights/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    setHighlights(prev => prev.map(h => h.id === id ? { ...h, ...data } : h))
  }

  async function deleteHighlight(id: string) {
    await fetch(`/api/highlights/${id}`, { method: 'DELETE' })
    setHighlights(prev => prev.filter(h => h.id !== id))
  }

  return { highlights, addHighlight, updateHighlight, deleteHighlight, reload: load }
}
