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
const PREFERRED_VOICES: Record<'en' | 'zh', string[]> = {
  en: [
    'Google US English', 'Samantha', 'Ava (Enhanced)', 'Ava', 'Allison', 'Joelle',
    'Microsoft Aria Online (Natural)', 'Microsoft Jenny', 'Microsoft Guy',
    'Microsoft Aria', 'Daniel', 'Karen', 'Serena', 'Moira',
  ],
  zh: [
    'Google 普通话（中国大陆）', 'Tingting', '婷婷', 'Meijia',
    'Microsoft Xiaoxiao Online (Natural)', 'Microsoft Yunxi', 'Microsoft Xiaoyi', 'Sinji',
  ],
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = cachedVoices.length ? cachedVoices : loadVoices()
  if (!voices.length) return null
  const isZh = lang.toLowerCase().startsWith('zh')
  const prefs = isZh ? PREFERRED_VOICES.zh : PREFERRED_VOICES.en
  const langPrefix = isZh ? 'zh' : 'en'

  // 1. Exact preferred name.
  for (const name of prefs) {
    const v = voices.find(x => x.name === name)
    if (v) return v
  }
  // 2. Preferred name as a substring (handles "(United States)" suffixes etc.).
  for (const name of prefs) {
    const v = voices.find(x => x.name.toLowerCase().includes(name.toLowerCase()))
    if (v) return v
  }
  // 3. Best remaining voice for the language: prefer natural/enhanced/premium/
  //    neural/google voices, then anything that isn't a known low-quality engine.
  const langMatches = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix))
  const natural = langMatches.find(v => /natural|enhanced|premium|neural|google/i.test(v.name))
  if (natural) return natural
  const notCompact = langMatches.find(v => !/compact|espeak|eloquence|pico/i.test(v.name))
  if (notCompact) return notCompact
  return langMatches[0] ?? null
}

export function speak(text: string, lang = 'en-US') {
  if (!speechSynthesisSupported()) return
  try {
    window.speechSynthesis.cancel()
    const clean = cleanForSpeech(text)
    if (!clean) return
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

export function stopSpeaking() {
  if (!speechSynthesisSupported()) return
  try { window.speechSynthesis.cancel() } catch { /* noop */ }
}

// Map the app's language code to a BCP-47 tag for STT/TTS.
export function voiceLangTag(language: string): string {
  return language === 'zh' ? 'zh-CN' : 'en-US'
}
