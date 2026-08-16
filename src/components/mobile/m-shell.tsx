'use client'
/**
 * MobileShell — the /m app. One component owns the design's state machine:
 * tabs (Today / Trees / Notes) + full-screen overlays (Reader / Review /
 * Note editor / The Answer), mirroring the design file's view presets. Data
 * loads in two calls (/api/user/mobile + /api/xp/summary) and refreshes when
 * an overlay closes, so verdicts/XP earned inside always land back on the
 * tabs.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
  fetchMobileData, fetchXpSummary, type MobileData, type XpSummary, type MNote,
} from './m-api'
import { TodayTab, TreesTab, NotesTab, TabBar } from './m-tabs'
import { MReader } from './m-reader'
import { MReview } from './m-review'
import { MNoteEdit } from './m-note-edit'
import { MAnswer } from './m-answer'

export type ReaderTarget = {
  treeId: string; nodeId: string; nodeTitle: string; treeTitle: string
  language: string | null; autoplay?: boolean; chat?: boolean
  mastery?: { filled: number; target: number } | null
  /** Which tab opened the reader — the back button names it honestly. */
  from?: 'today' | 'trees'
}
type Overlay =
  | { kind: 'reader'; target: ReaderTarget }
  | { kind: 'review' }
  | { kind: 'note'; note: MNote }
  | { kind: 'answer'; treeId: string; treeTitle: string; language: string | null }
  | null

export function MobileShell() {
  const { t, language } = useLanguage()
  const [data, setData] = useState<MobileData | null>(null)
  const [xp, setXp] = useState<XpSummary | null>(null)
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'today' | 'trees' | 'notes'>('today')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    const [d, x] = await Promise.all([fetchMobileData(), fetchXpSummary()])
    if (d) setData(d)
    if (x) setXp(x)
    if (!d && !x) setFailed(true)
    else setFailed(false)
  }, [])

  useEffect(() => {
    void refresh()
    fetch('/api/account/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { const n = (d?.user?.name as string | null) ?? ''; if (n) setName(n.split(' ')[0]) })
      .catch(() => { /* greeting stays name-less */ })
  }, [refresh])

  const openReader = useCallback((target: ReaderTarget) => setOverlay({ kind: 'reader', target }), [])
  const closeOverlay = useCallback(() => { setOverlay(null); void refresh() }, [refresh])

  if (overlay?.kind === 'reader') {
    return <MReader key={overlay.target.nodeId} target={overlay.target} onClose={closeOverlay}
      onOpenNode={(nodeId, nodeTitle) => setOverlay({
        kind: 'reader',
        target: { ...overlay.target, nodeId, nodeTitle, autoplay: false, mastery: null },
      })} />
  }
  if (overlay?.kind === 'review') {
    return <MReview queue={data?.reviewQueue ?? []} onClose={closeOverlay} />
  }
  if (overlay?.kind === 'note') {
    return <MNoteEdit note={overlay.note} onClose={closeOverlay} />
  }
  if (overlay?.kind === 'answer') {
    return <MAnswer treeId={overlay.treeId} treeTitle={overlay.treeTitle} onClose={closeOverlay} />
  }

  const loading = !data && !failed

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="m-scroll" style={{ flex: 1, paddingBottom: 96 }}>
        {loading && (
          <div style={{ padding: 'calc(var(--m-safe-top) + 40px) 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="m-skel" style={{ height: 28, width: '60%' }} />
            <div className="m-skel" style={{ height: 120 }} />
            <div className="m-skel" style={{ height: 54 }} />
            <div className="m-skel" style={{ height: 54 }} />
          </div>
        )}
        {failed && !data && (
          <button className="m-btn m-btn-secondary" onClick={() => { setFailed(false); void refresh() }}
            style={{ margin: 'calc(var(--m-safe-top) + 80px) auto 0', display: 'flex' }}>
            {t('m.tapRetry')}
          </button>
        )}
        {data && tab === 'today' && (
          <TodayTab data={data} xp={xp} name={name} t={t} uiLang={language}
            onOpenReader={target => openReader({ ...target, from: 'today' })}
            onStartReview={() => setOverlay({ kind: 'review' })} />
        )}
        {data && tab === 'trees' && (
          <TreesTab data={data} t={t}
            onOpenReader={target => openReader({ ...target, from: 'trees' })}
            onOpenAnswer={(treeId, treeTitle, lang) => setOverlay({ kind: 'answer', treeId, treeTitle, language: lang })} />
        )}
        {data && tab === 'notes' && (
          <NotesTab data={data} t={t} uiLang={language} onOpenNote={n => setOverlay({ kind: 'note', note: n })} />
        )}
      </div>
      <TabBar tab={tab} t={t} reviewDot={(data?.reviewQueue.length ?? 0) > 0}
        onTab={setTab} onReview={() => setOverlay({ kind: 'review' })} />
    </div>
  )
}
