'use client'
/**
 * Reader overlay — one node, same laws as desktop (qa-findings-4 №2):
 * lands in the ASK-FIRST checkpoint chat (the [NODE_INTRO] syllabus + the
 * checkpoint loop — Bottleneck-Triggered Teaching's default mode is ASKING),
 * with the full explainer generated ON DEMAND in the Read tab. A wrong
 * answer auto-fires the law-mandated [NODE_REMEDIATE] full explainer (no tap
 * gate); verification auto-fires the [NODE_VERIFIED] payoff turn, whose
 * [[NEXT_NODE]] button renders as the continue CTA. Listen reads the
 * explainer aloud once it exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { emitXpAwards } from '@/components/xp-toast'
import {
  fetchExplainer, fetchNodeChat, streamNodeChat, visibleProse, parseNextNode,
  type MChatMsg, type MQuiz, type QuizVerdict,
} from './m-api'
import { MQuizCard } from './m-quiz-card'
import { IconChevronLeft, IconHeadphones, IconPause, IconSend, IconSketch } from './m-icons'
import type { ReaderTarget } from './m-shell'

const SPEEDS = [1, 1.2, 1.5, 2]

/** Markdown → plain text for the read-aloud voice. */
function toSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[[A-Z_]+\]\][^\n]*/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function MReader({ target, onClose, onOpenNode }: {
  target: ReaderTarget
  onClose: () => void
  /** Open a sibling node in this reader (the [[NEXT_NODE]] payoff CTA). */
  onOpenNode?: (nodeId: string, nodeTitle: string) => void
}) {
  const { t, language } = useLanguage()
  const lang = target.language ?? language
  // ASK-FIRST LANDING: the checkpoint chat is the default surface; 'read'
  // (the explainer) is opened on demand. Only an explicit Listen tap lands
  // on Read, because listening reads the explainer.
  const [mode, setMode] = useState<'read' | 'chat'>(target.autoplay ? 'read' : 'chat')
  const [explainer, setExplainer] = useState<string | null>(null)
  // 'idle' until the learner asks — generating the full explainer up front
  // was an unrequested teaching-tier call AND a lecture-first landing.
  const [explState, setExplState] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle')
  const [msgs, setMsgs] = useState<MChatMsg[]>([])
  const [pending, setPending] = useState<MQuiz | null>(null)
  const [mastery, setMastery] = useState(target.mastery ?? null)
  const [lastVerdict, setLastVerdict] = useState<QuizVerdict | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [soliciting, setSoliciting] = useState(false)
  const [draft, setDraft] = useState('')

  // ── Listen (speechSynthesis) ──
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [playing, setPlaying] = useState(false)
  const [listenPct, setListenPct] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)
  const posRef = useRef(0)
  const speechRef = useRef('')
  const autoplayedRef = useRef(false)

  const speakFrom = useCallback((fromChar: number, rate: number) => {
    if (!ttsSupported || !speechRef.current) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(speechRef.current.slice(fromChar))
      u.lang = lang === 'zh' ? 'zh-CN' : 'en-US'
      u.rate = rate
      u.onboundary = e => {
        posRef.current = fromChar + (e.charIndex ?? 0)
        setListenPct(Math.min(100, posRef.current / Math.max(1, speechRef.current.length) * 100))
      }
      u.onend = () => {
        // Finished (not cancelled): reset to the top for a replay.
        if (posRef.current >= speechRef.current.length - 40) {
          posRef.current = 0
          setListenPct(0)
          setPlaying(false)
        }
      }
      window.speechSynthesis.speak(u)
    } catch { setPlaying(false) }
  }, [ttsSupported, lang])

  const togglePlay = useCallback(() => {
    if (!ttsSupported || !speechRef.current) return
    setPlaying(p => {
      if (p) { try { window.speechSynthesis.cancel() } catch { /* noop */ } return false }
      speakFrom(posRef.current, SPEEDS[speedIdx])
      return true
    })
  }, [ttsSupported, speakFrom, speedIdx])

  const cycleSpeed = useCallback(() => {
    setSpeedIdx(i => {
      const next = (i + 1) % SPEEDS.length
      if (playing) speakFrom(posRef.current, SPEEDS[next])
      return next
    })
  }, [playing, speakFrom])

  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch { /* noop */ } }, [])

  // ── Chat thread (the landing surface) ──
  const loadChat = useCallback(async () => {
    const d = await fetchNodeChat(target.treeId, target.nodeId)
    if (!d) return null
    setMsgs(d.messages)
    setPending(prev => (prev && d.pending && prev.question === d.pending.question ? prev : d.pending))
    return d
  }, [target.treeId, target.nodeId])

  // ── On-demand explainer (Read tab / Listen) ──
  const ensureExplainer = useCallback(async (thenPlay?: boolean) => {
    setExplState(s => (s === 'ok' || s === 'loading' ? s : 'loading'))
    const expl = await fetchExplainer(target.treeId, target.nodeId, lang)
    if (expl) {
      setExplainer(expl); setExplState('ok')
      speechRef.current = toSpeech(expl)
      if (thenPlay && ttsSupported) {
        setPlaying(true)
        speakFrom(0, SPEEDS[0])
      }
    } else setExplState('failed')
  }, [target.treeId, target.nodeId, lang, ttsSupported, speakFrom])

  useEffect(() => {
    let dead = false
    void (async () => {
      const chat = await loadChat()
      if (dead) return
      // Listen tap from Today: the ONE path that generates the explainer
      // unprompted — the learner explicitly asked to hear it.
      if (target.autoplay && !autoplayedRef.current) {
        autoplayedRef.current = true
        void ensureExplainer(true)
      }
      // First-ever open: fire the syllabus-contract intro turn — it streams
      // visibly into the chat the learner is looking at.
      if (chat && chat.messages.length === 0) {
        setStreaming(true); setStreamText('')
        const r = await streamNodeChat({
          treeId: target.treeId, nodeId: target.nodeId, message: '[NODE_INTRO]', lang,
          onText: v => { if (!dead) setStreamText(v) },
        })
        if (dead) return
        setStreaming(false); setStreamText('')
        if (r.xp.length) emitXpAwards(r.xp)
        if (r.quiz) setPending(r.quiz)
        void loadChat()
      }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Entering the Read tab IS the demand — generate (or fetch the cached
  // explainer) on first entry, never on mount.
  useEffect(() => {
    if (mode === 'read' && explState === 'idle') void ensureExplainer()
  }, [mode, explState, ensureExplainer])

  // ── Checkpoint solicitation ([NODE_CHECKPOINT]) ──
  const solicit = useCallback(async () => {
    if (soliciting || streaming) return
    setSoliciting(true); setLastVerdict(null)
    const r = await streamNodeChat({ treeId: target.treeId, nodeId: target.nodeId, message: '[NODE_CHECKPOINT]', lang })
    if (r.xp.length) emitXpAwards(r.xp)
    if (r.quiz) setPending(r.quiz)
    else await loadChat()
    setSoliciting(false)
  }, [soliciting, streaming, target.treeId, target.nodeId, lang, loadChat])

  // ── Chat ──
  const sendTurn = useCallback(async (message: string, showUser: boolean) => {
    if (streaming) return
    if (showUser) setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: message }])
    setStreaming(true); setStreamText('')
    const r = await streamNodeChat({
      treeId: target.treeId, nodeId: target.nodeId, message, lang,
      onText: setStreamText,
    })
    setStreaming(false); setStreamText('')
    if (r.budgetNote) {
      setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'assistant', content: r.budgetNote as string }])
      return
    }
    if (r.prose) setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'assistant', content: `${r.prose}${r.next ? `\n\n[[NEXT_NODE]]${JSON.stringify(r.next)}` : ''}` }])
    if (r.xp.length) emitXpAwards(r.xp)
    if (r.quiz) { setPending(r.quiz); setLastVerdict(null) }
    setTimeout(() => { void loadChat() }, 600)
  }, [streaming, target.treeId, target.nodeId, lang, loadChat])

  const send = useCallback(() => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void sendTurn(text, true)
  }, [draft, streaming, sendTurn])

  // Bottleneck-Triggered Teaching, enforced on this surface too: a wrong
  // answer AUTO-fires the full remediation turn (never a tap-gated two-line
  // verdict), and a fresh verification AUTO-fires the [NODE_VERIFIED] payoff
  // turn whose [[NEXT_NODE]] button routes the momentum somewhere.
  const onVerdict = useCallback((v: QuizVerdict) => {
    setLastVerdict(v)
    if (v.mastery) setMastery({ filled: v.mastery.correct, target: v.mastery.target })
    if (!v.correct) {
      setTimeout(() => {
        setPending(null)
        setMode('chat')
        void sendTurn('[NODE_REMEDIATE]', false)
      }, 1400)
    } else if (v.verified) {
      setTimeout(() => {
        setPending(null)
        setMode('chat')
        void sendTurn('[NODE_VERIFIED]', false)
      }, 1600)
    }
  }, [sendTurn])

  const verifiedNow = !!(lastVerdict?.verified || lastVerdict?.alreadyVerified)
  const afterCorrect = lastVerdict?.correct
    ? lastVerdict.verified
      ? null // the payoff turn takes over — its NEXT_NODE button is the CTA
      : lastVerdict.alreadyVerified
        ? { label: t('m.backToToday'), onClick: onClose }
        : { label: t('m.nextCheckpoint'), onClick: () => { setPending(null); void solicit() } }
    : null

  const remainingSec = (() => {
    const cps = (lang === 'zh' ? 4.5 : 15) * SPEEDS[speedIdx]
    const left = speechRef.current.length * (1 - listenPct / 100)
    return Math.max(0, Math.round(left / Math.max(1, cps)))
  })()

  const seg = (on: boolean) => ({
    padding: '5px 13px', fontSize: 12.5, cursor: 'pointer', borderRadius: 99,
    color: on ? 'var(--m-accent)' : 'var(--m-neutral-400)',
    boxShadow: on ? 'inset 0 0 0 1px var(--m-accent)' : 'none',
  } as const)

  const masteryLabel = verifiedNow
    ? t('m.resumeVerified')
    : mastery
      ? t('m.proven').replace('{a}', String(mastery.filled)).replace('{b}', String(mastery.target))
      : null

  const quizCard = pending && (
    <MQuizCard key={pending.question} quiz={pending} treeId={target.treeId} nodeId={target.nodeId}
      lang={lang} t={t} onVerdict={onVerdict} afterCorrect={afterCorrect}
      onStale={() => { setPending(null); void loadChat() }} />
  )

  // Quiz-me is DISABLED while a turn streams or a card is being solicited —
  // it used to render enabled-but-dead during the intro stream.
  const quizMeButton = !pending && !verifiedNow && !streaming && (soliciting
    ? <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-500)' }}>{t('m.bobThinking')}</p>
    : <button className="m-btn m-btn-primary m-btn-block" onClick={() => void solicit()}>{t('m.quizMe')}</button>)

  const backLabel = t(target.from === 'trees' ? 'm.tabTrees' : 'm.tabToday')

  const nextNodeButton = (nn: { nodeId: string; title: string }) => onOpenNode && (
    <button className="m-btn m-btn-primary" style={{ alignSelf: 'flex-start', fontSize: 13, marginTop: 6 }}
      onClick={() => onOpenNode(nn.nodeId, nn.title)}>
      {t('m.nextNode').replace('{title}', nn.title)}
    </button>
  )

  return (
    <div className="m-rise" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      {/* Header */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(var(--m-safe-top) + 26px) 16px 10px', borderBottom: '1px solid var(--m-divider)' }}>
        <button className="m-btn m-btn-ghost" style={{ padding: '4px 6px', fontSize: 13 }} onClick={onClose}>
          <IconChevronLeft size={15} />{backLabel}
        </button>
        <div style={{ flex: 1 }} />
        <div className="m-seg" style={{ borderRadius: 99 }}>
          <span style={seg(mode === 'chat')} onClick={() => setMode('chat')}>{t('m.askBob')}</span>
          <span style={seg(mode === 'read')} onClick={() => setMode('read')}>{t('m.read')}</span>
        </div>
        {ttsSupported && (
          <button className="m-btn m-btn-icon m-btn-secondary" style={{ width: 32, height: 32, borderRadius: 99 }}
            onClick={togglePlay} title={t('m.listenMode')} disabled={explState !== 'ok'}>
            {playing
              ? <span style={{ color: 'var(--m-accent)', display: 'inline-flex' }}><IconPause size={14} /></span>
              : <IconHeadphones size={15} />}
          </button>
        )}
      </div>

      {/* Read mode — the on-demand explainer */}
      {mode === 'read' && (
        <div className="m-scroll" style={{ flex: 1 }}>
          <div style={{ padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 10, letterSpacing: '.13em', textTransform: 'uppercase', color: 'var(--m-accent)' }}>
                {t('m.node')} · {target.treeTitle}
              </p>
              <h3 style={{ fontSize: 23, lineHeight: 1.18 }}>{target.nodeTitle}</h3>
              {masteryLabel && <p style={{ margin: 0, fontSize: 12, color: 'var(--m-neutral-500)' }}>{masteryLabel}</p>}
            </div>

            {explState === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--m-neutral-400)' }}>{t('m.explainerIntro')}</p>
                <button className="m-btn m-btn-primary" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={() => void ensureExplainer()}>{t('m.writeExplainer')}</button>
              </div>
            )}
            {explState === 'loading' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="m-skel" style={{ height: 15 }} />
                <div className="m-skel" style={{ height: 15, width: '92%' }} />
                <div className="m-skel" style={{ height: 15, width: '80%' }} />
                <div style={{ border: '1px dashed var(--m-neutral-700)', borderRadius: 'var(--m-radius-md)', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: 'var(--m-neutral-600)', display: 'inline-flex' }}><IconSketch size={20} /></span>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--m-neutral-500)', textAlign: 'center' }}>{t('m.explainerWriting')}</p>
                </div>
                <div className="m-skel" style={{ height: 15, width: '88%' }} />
              </div>
            )}
            {explState === 'failed' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--m-neutral-400)' }}>{t('m.explainerRetry')}</p>
                <button className="m-btn m-btn-secondary" style={{ alignSelf: 'flex-start', fontSize: 12.5 }} onClick={() => void ensureExplainer()}>{t('m.retry')}</button>
              </div>
            )}
            {explState === 'ok' && explainer && (
              <div className="m-reader-body">
                <MarkdownRenderer content={explainer} imageContext={`${target.treeTitle} — ${target.nodeTitle}`} />
              </div>
            )}

            <div className="m-hr" />

            {quizCard}
            {quizMeButton}
          </div>
        </div>
      )}

      {/* Chat mode — the ask-first landing */}
      {mode === 'chat' && (
        <>
          <div className="m-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
              {msgs.filter(m => m.role === 'user' || m.role === 'assistant').map(m => {
                const prose = visibleProse(m.content).trim()
                if (!prose) return null
                const nn = m.role === 'assistant' ? parseNextNode(m.content) : null
                return m.role === 'assistant' ? (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div className="m-chat-body" style={{ maxWidth: '88%', borderRadius: '14px 14px 14px 4px', padding: '11px 14px', background: 'var(--m-surface)' }}>
                      <MarkdownRenderer content={prose} />
                    </div>
                    {nn && nextNodeButton(nn)}
                  </div>
                ) : (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div className="m-chat-body" style={{ maxWidth: '82%', borderRadius: '14px 14px 4px 14px', padding: '11px 14px', background: 'var(--m-accent-900)', border: '1px solid var(--m-accent-800)' }}>
                      {prose}
                    </div>
                  </div>
                )
              })}
              {streaming && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  {streamText.trim() ? (
                    <div className="m-chat-body" style={{ maxWidth: '88%', borderRadius: '14px 14px 14px 4px', padding: '11px 14px', background: 'var(--m-surface)' }}>
                      <MarkdownRenderer content={streamText} />
                    </div>
                  ) : (
                    <div style={{ borderRadius: 14, padding: '11px 16px', background: 'var(--m-surface)', fontSize: 14, color: 'var(--m-neutral-500)' }}>
                      {t('m.bobThinking')}
                    </div>
                  )}
                </div>
              )}
              {!streaming && quizCard}
              {quizMeButton}
            </div>
          </div>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px calc(var(--m-safe-bottom) + 14px)', borderTop: '1px solid var(--m-divider)' }}>
            <input className="m-input" style={{ flex: 1, borderRadius: 99, padding: '8px 16px', minHeight: 40 }}
              placeholder={t('m.chatPlaceholder')} value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }} />
            <button className="m-btn m-btn-icon m-btn-primary" style={{ borderRadius: 99, width: 40, height: 40, flex: 'none' }}
              onClick={send} disabled={streaming || !draft.trim()}>
              <IconSend size={16} />
            </button>
          </div>
        </>
      )}

      {/* Listen bar */}
      {playing && (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px calc(var(--m-safe-bottom) + 10px)', borderTop: '1px solid var(--m-divider)', background: 'color-mix(in srgb, var(--m-bg) 90%, black)' }}>
          <button className="m-btn m-btn-icon m-btn-primary" style={{ borderRadius: 99, width: 36, height: 36, flex: 'none' }} onClick={togglePlay}>
            <IconPause size={13} />
          </button>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--m-neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('m.listeningTo').replace('{title}', target.nodeTitle)}
            </p>
            <div className="m-bar"><div style={{ width: `${listenPct}%`, transition: 'none' }} /></div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--m-neutral-500)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
            -{Math.floor(remainingSec / 60)}:{String(remainingSec % 60).padStart(2, '0')}
          </span>
          <button className="m-btn m-btn-secondary" style={{ fontSize: 11.5, padding: '3px 9px', flex: 'none', borderRadius: 99 }} onClick={cycleSpeed}>
            {SPEEDS[speedIdx]}×
          </button>
        </div>
      )}
    </div>
  )
}
