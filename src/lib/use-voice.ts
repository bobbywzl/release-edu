'use client'
/**
 * Voice helpers for the chat — built on the browser's Web Speech API.
 *  - useSpeechRecognition: push-to-talk speech → text (mic button).
 *  - speak / stopSpeaking: read text aloud (Bob's replies).
 * All feature-detected and fully optional: on unsupported browsers the hooks
 * report `supported: false` and the UI hides the controls.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
function getSpeechRecognitionCtor(): any | null {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

export function useSpeechRecognition(opts: {
  lang?: string
  onFinal?: (text: string) => void
}) {
  const { lang = 'en-US', onFinal } = opts
  const [supported] = useState(() => !!getSpeechRecognitionCtor())
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const langRef = useRef(lang)
  langRef.current = lang

  const stop = useCallback(() => {
    try { recRef.current?.stop() } catch { /* noop */ }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return
    try { recRef.current?.abort?.() } catch { /* noop */ }
    const rec = new Ctor()
    rec.lang = langRef.current
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e: any) => {
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
      }
      if (finalText && onFinalRef.current) onFinalRef.current(finalText.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { setListening(false) }
  }, [])

  const toggle = useCallback(() => { if (listening) stop(); else start() }, [listening, start, stop])

  // Clean up on unmount.
  useEffect(() => () => { try { recRef.current?.abort?.() } catch { /* noop */ } }, [])

  return { supported, listening, start, stop, toggle }
}

// ── Text-to-speech ──────────────────────────────────────────────────────────

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// Strip markdown / code / visualization / math so TTS reads clean prose only.
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '. ')        // fenced blocks (code/quiz/chart/etc.)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → label text
    .replace(/\$\$[\s\S]*?\$\$/g, '. ')        // block math
    .replace(/\$[^$\n]*\$/g, ' ')              // inline math
    .replace(/[*_#`>~|]/g, '')                  // markdown punctuation
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Voice selection ──────────────────────────────────────────────────────────
// The browser default voice is frequently a low-quality, strained ("robotic /
// suffocating") compact voice. We instead pick the most natural-sounding voice
// available on the device, preferring known high-quality named voices.

let cachedVoices: SpeechSynthesisVoice[] = []
function loadVoices(): SpeechSynthesisVoice[] {
  if (!speechSynthesisSupported()) return []
  try { cachedVoices = window.speechSynthesis.getVoices() || [] } catch { cachedVoices = [] }
  return cachedVoices
}
if (speechSynthesisSupported()) {
  loadVoices()
  // Voices load asynchronously on Chrome/Edge — refresh when they arrive.
  try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices) } catch { /* noop */ }
}

// Curated, in order of preference. These are warm, natural, "teacher-like"
// system voices across macOS / iOS / Windows / Chrome.
// Curated high-quality names (warm, natural, teacher-like), used as a tiebreak.
const PREFERRED_VOICES: Record<'en' | 'zh', string[]> = {
  en: [
    'Google US English', 'Microsoft Aria Online (Natural)', 'Microsoft Jenny',
    'Ava (Enhanced)', 'Samantha (Enhanced)', 'Allison (Enhanced)', 'Ava', 'Allison',
    'Samantha', 'Joelle', 'Microsoft Guy', 'Daniel', 'Serena',
  ],
  zh: [
    'Google 普通话（中国大陆）', 'Microsoft Xiaoxiao Online (Natural)',
    'Tingting (Enhanced)', 'Tingting', '婷婷', 'Microsoft Yunxi', 'Meijia',
  ],
}

// Novelty / robotic / low-fidelity engines to avoid — these are the
// "suffocating"-sounding ones (macOS joke voices, eSpeak, compact synths).
const BAD_VOICE = /compact|espeak|eloquence|pico|fred|albert|zarvox|whisper|bells|bahh|trinoids|cellos|deranged|bubbles|hysterical|boing|junior|ralph|kathy|bad news|good news|wobble|organ|superstar|grandma|grandpa|rocko|shelley|sandy|flo|reed|eddy|rishi/i

// Higher score = better. The dominant signal is whether the voice is a
// network/neural voice (localService === false) — those are the modern,
// natural ones; local voices are usually the strained-sounding synths.
function scoreVoice(v: SpeechSynthesisVoice, prefs: string[]): number {
  const name = v.name.toLowerCase()
  let s = 0
  if (v.localService === false) s += 60                                   // network/neural
  if (/natural|neural|enhanced|premium|online/.test(name)) s += 40
  if (/google/.test(name)) s += 28
  if (/microsoft/.test(name)) s += 14
  const idx = prefs.findIndex(p => name.includes(p.toLowerCase()))
  if (idx >= 0) s += 30 - idx                                             // curated, earlier = better
  if (BAD_VOICE.test(name)) s -= 100
  if (v.default) s += 1
  return s
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = cachedVoices.length ? cachedVoices : loadVoices()
  if (!voices.length) return null
  const isZh = lang.toLowerCase().startsWith('zh')
  const prefs = isZh ? PREFERRED_VOICES.zh : PREFERRED_VOICES.en
  const langPrefix = isZh ? 'zh' : 'en'
  const matches = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix))
  if (!matches.length) return null
  return matches
    .map(v => ({ v, s: scoreVoice(v, prefs) }))
    .sort((a, b) => b.s - a.s)[0].v
}

function speakNow(clean: string, lang: string) {
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(clean)
    u.lang = lang
    const v = pickVoice(lang)
    if (v) u.voice = v
    // A touch slower than default + neutral pitch = calmer, clearer, teacherly.
    u.rate = 0.95
    u.pitch = 1.0
    u.volume = 1.0
    window.speechSynthesis.speak(u)
  } catch { /* noop */ }
}

export function speak(text: string, lang = 'en-US') {
  if (!speechSynthesisSupported()) return
  const clean = cleanForSpeech(text)
  if (!clean) return
  // Voices load asynchronously (Chrome/Edge). If they're not ready yet, wait
  // briefly so even the FIRST utterance gets the upgraded voice rather than the
  // browser default — otherwise the first reply is the one that sounds bad.
  if (cachedVoices.length || loadVoices().length) { speakNow(clean, lang); return }
  let fired = false
  const go = () => {
    if (fired) return
    fired = true
    loadVoices()
    speakNow(clean, lang)
  }
  try { window.speechSynthesis.addEventListener('voiceschanged', go, { once: true }) } catch { /* noop */ }
  setTimeout(go, 350)
}

export function stopSpeaking() {
  if (!speechSynthesisSupported()) return
  try { window.speechSynthesis.cancel() } catch { /* noop */ }
}

// Map the app's language code to a BCP-47 tag for STT/TTS.
export function voiceLangTag(language: string): string {
  return language === 'zh' ? 'zh-CN' : 'en-US'
}
