'use client'
/** Full-screen note viewer/editor for one node — the Notes tab's open state.
 *  Saves through the existing PATCH node {action:'notes'}; back auto-saves
 *  dirty text (fire-and-forget) so nothing typed is ever lost. */
import { useCallback, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { saveNodeNotes, type MNote } from './m-api'
import { IconChevronLeft } from './m-icons'

export function MNoteEdit({ note, onClose }: { note: MNote; onClose: () => void }) {
  const { t } = useLanguage()
  const [text, setText] = useState(note.text)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle')
  const dirty = text !== note.text

  const save = useCallback(async () => {
    setSaved('saving')
    const ok = await saveNodeNotes(note.treeId, note.nodeId, text)
    setSaved(ok ? 'ok' : 'fail')
    if (ok) setTimeout(() => setSaved('idle'), 1600)
  }, [note.treeId, note.nodeId, text])

  const back = useCallback(() => {
    if (dirty) void saveNodeNotes(note.treeId, note.nodeId, text)
    onClose()
  }, [dirty, note.treeId, note.nodeId, text, onClose])

  return (
    <div className="m-rise" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(var(--m-safe-top) + 26px) 16px 10px', borderBottom: '1px solid var(--m-divider)' }}>
        <button className="m-btn m-btn-ghost" style={{ padding: '4px 6px', fontSize: 13 }} onClick={back}>
          <IconChevronLeft size={15} />{t('m.tabNotes')}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note.nodeTitle}</p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--m-neutral-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note.treeTitle}</p>
        </div>
        <button className="m-btn m-btn-primary" style={{ fontSize: 12.5, padding: '5px 12px' }}
          onClick={() => void save()} disabled={saved === 'saving' || !dirty}>
          {saved === 'saving' ? t('common.loading') : saved === 'ok' ? t('m.noteSaved') : t('m.noteSave')}
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 16px calc(var(--m-safe-bottom) + 14px)' }}>
        <textarea className="m-input"
          style={{ flex: 1, resize: 'none', fontSize: 14.5, lineHeight: 1.65, padding: 14, borderRadius: 'var(--m-radius-md)' }}
          placeholder={t('m.notePlaceholder')} value={text} onChange={e => setText(e.target.value)} />
        {saved === 'fail' && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--m-neutral-400)' }}>{t('m.noteSaveFailed')}</p>}
      </div>
    </div>
  )
}
