'use client'
/**
 * SOTA multimodal chat input — ONE implementation shared by the Tree Copilot
 * and every node workspace chat, so attachments behave identically everywhere:
 *   📎 any file · 📷 camera photo · 🎥 video (native camera on mobile via
 *   capture inputs) · 🎙️ in-browser voice notes (MediaRecorder, auto-stop 90s).
 * Files stage as removable chips; media reads to data: URIs (text-like files
 * as text). Server-side, every attachment goes through Gemini before Bob's
 * turn (images/video/PDFs analyzed, voice transcribed) and persists as
 * LinkedFile evidence.
 *
 * The ~3MB/file cap (hosting request-size cap) is enforced with a VISIBLE
 * note — never silent truncation (truncated base64 is corrupt).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Camera, Video, Mic, Square, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface ChatAttachment { name: string; type: string; content: string }

/** Request bodies must stay under Vercel's ~4.5MB cap — media above this is
 *  rejected with a visible note, never silently truncated. */
export const MAX_ATTACH_BYTES = 3_000_000

/** The user-bubble / persisted-record label for a message with attachments. */
export function attachmentLabel(message: string, atts: ChatAttachment[]): string {
  if (atts.length === 0) return message
  return `${message}${message ? '\n' : ''}[${atts.map(a => `📎 ${a.name}`).join(' · ')}]`
}

export function useAttachments() {
  const { t } = useLanguage()
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // Set by cancelRecording so an in-flight recording stopped by a node
  // switch / unmount is dropped instead of landing in the next context.
  const discardRef = useRef(false)

  const addFiles = useCallback(async (files: FileList | null, fallbackName: string) => {
    const file = files?.[0]
    if (!file) return
    if (file.size > MAX_ATTACH_BYTES) { setNote(t('tree.copilotTooLarge')); return }
    const isTextLike = file.type.startsWith('text/') || /json|xml|csv|javascript|markdown/.test(file.type)
    const content: string = await new Promise(res => {
      const r = new FileReader()
      r.onload = () => res(String(r.result ?? ''))
      if (isTextLike) r.readAsText(file); else r.readAsDataURL(file)
    })
    setAttachments(a => [...a.slice(-2), { name: file.name || fallbackName, type: file.type || 'application/octet-stream', content }])
    setNote(null)
  }, [t])

  const toggleRecord = useCallback(async () => {
    if (recRef.current?.state === 'recording') { try { recRef.current.stop() } catch { /* already stopped */ } return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop())
        setRecording(false)
        const discarded = discardRef.current
        discardRef.current = false
        if (discarded) return
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size === 0) return
        if (blob.size > MAX_ATTACH_BYTES) { setNote(t('tree.copilotTooLarge')); return }
        const r = new FileReader()
        r.onload = () => setAttachments(a => [...a.slice(-2), {
          name: `voice-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.webm`,
          type: blob.type || 'audio/webm',
          content: String(r.result ?? ''),
        }])
        r.readAsDataURL(blob)
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
      // Hard cap so a forgotten mic can't record forever (also keeps size sane).
      setTimeout(() => { if (recRef.current === rec && rec.state === 'recording') rec.stop() }, 90_000)
    } catch {
      setNote(t('tree.copilotMicDenied'))
    }
  }, [t])

  /** Stop AND drop any in-flight recording (context switch / unmount). */
  const cancelRecording = useCallback(() => {
    const rec = recRef.current
    if (rec && rec.state === 'recording') {
      discardRef.current = true
      try { rec.stop() } catch { discardRef.current = false }
    }
  }, [])

  const removeAt = useCallback((i: number) => setAttachments(a => a.filter((_, j) => j !== i)), [])
  const clear = useCallback(() => { setAttachments([]); setNote(null) }, [])

  // Never leave a mic running after the surface unmounts.
  useEffect(() => () => {
    const rec = recRef.current
    if (rec && rec.state === 'recording') {
      discardRef.current = true
      try { rec.stop() } catch { /* already stopped */ }
    }
  }, [])

  return { attachments, note, setNote, recording, addFiles, toggleRecord, cancelRecording, removeAt, clear }
}

/** The four capture controls: 📎 file · 📷 photo · 🎥 video · 🎙️ voice. */
export function CaptureControls({ addFiles, recording, toggleRecord }: {
  addFiles: (files: FileList | null, fallbackName: string) => void | Promise<void>
  recording: boolean
  toggleRecord: () => void
}) {
  const { t } = useLanguage()
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-1">
      <input ref={fileRef} type="file" className="hidden" onChange={e => { addFiles(e.target.files, 'file'); e.target.value = '' }} />
      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { addFiles(e.target.files, 'photo.jpg'); e.target.value = '' }} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={e => { addFiles(e.target.files, 'video.mp4'); e.target.value = '' }} />
      <button type="button" onClick={() => fileRef.current?.click()} title={t('tree.copilotAttachFile')} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Paperclip className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => photoRef.current?.click()} title={t('tree.copilotAttachPhoto')} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Camera className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => videoRef.current?.click()} title={t('tree.copilotAttachVideo')} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Video className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={toggleRecord}
        title={recording ? t('tree.copilotRecording') : t('tree.copilotAttachVoice')}
        className={cn(
          'p-2 rounded-lg transition-colors',
          recording ? 'text-red-400 bg-red-500/15 animate-pulse' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
        )}
      >
        {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
      {recording && <span className="text-[10px] text-red-400">{t('tree.copilotRecording')}</span>}
    </div>
  )
}

/** Size-cap / mic notes + the staged attachment chips (removable). */
export function AttachmentTray({ attachments, note, onRemove }: {
  attachments: ChatAttachment[]
  note: string | null
  onRemove: (index: number) => void
}) {
  if (!note && attachments.length === 0) return null
  return (
    <div className="space-y-1.5">
      {note && <p className="text-[11px] text-amber-400">{note}</p>}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] bg-background border border-border rounded-full pl-2.5 pr-1.5 py-1 text-foreground/85 max-w-[240px]">
              <Paperclip className="w-3 h-3 text-primary flex-shrink-0" />
              <span className="truncate">{a.name}</span>
              <button type="button" onClick={() => onRemove(i)} className="p-0.5 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
