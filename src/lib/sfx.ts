'use client'
/**
 * Reward sound effects — synthesized with WebAudio (zero assets, instant).
 *
 * The palette copies what proven habit apps use:
 * - XP ding: a short bright two-note blip (Duolingo "correct" / iOS tri-tone
 *   family) — high frequency, fast decay, unmistakably positive.
 * - Level-up: an ascending major arpeggio with a shimmer tail (classic RPG
 *   level-up grammar — rising pitch = rising status).
 * - Badge unlock: a warm rolled major chord (trophy/achievement grammar,
 *   à la Xbox achievement).
 *
 * All sounds are < 0.8s, gain-enveloped (no clicks), and gated behind a
 * user-toggleable setting persisted in localStorage ('bob-sfx', default on).
 * Browsers only allow audio after a user gesture — XP events always follow
 * one (answering, sending), so autoplay policies are naturally satisfied.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function sfxEnabled(): boolean {
  try { return localStorage.getItem('bob-sfx') !== '0' } catch { return true }
}

export function setSfxEnabled(on: boolean): void {
  try { localStorage.setItem('bob-sfx', on ? '1' : '0') } catch { /* noop */ }
}

/** One enveloped oscillator note. */
function note(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  opts: { type?: OscillatorType; peak?: number } = {},
) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, startAt)
  const peak = opts.peak ?? 0.12
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.05)
}

/** Small-step reward: bright two-note ding (E6 → B6). */
export function playXpDing(): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  note(c, 1318.5, t, 0.14, { peak: 0.1 })          // E6
  note(c, 1975.5, t + 0.09, 0.22, { peak: 0.09 })  // B6
}

/** Level-up: ascending C-major arpeggio + octave shimmer. */
export function playLevelUp(): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  const seq = [523.25, 659.25, 784.0, 1046.5] // C5 E5 G5 C6
  seq.forEach((f, i) => note(c, f, t + i * 0.09, 0.3, { type: 'triangle', peak: 0.12 }))
  // Shimmer tail — quiet octave sparkle over the final chord.
  note(c, 2093.0, t + 0.36, 0.5, { peak: 0.05 })
  note(c, 1568.0, t + 0.42, 0.45, { peak: 0.04 })
}

/** Badge unlock: warm rolled major chord (G4 B4 D5 G5). */
export function playBadgeUnlock(): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  const chord = [392.0, 493.88, 587.33, 784.0]
  chord.forEach((f, i) => note(c, f, t + i * 0.045, 0.6, { type: 'triangle', peak: 0.09 }))
}

// ── Rank-up fanfare (escalating grandeur) ──────────────────────────────────
// The ladder should SOUND like it climbs: each higher tier layers on more —
// a rising sweep, stacked/detuned saws, octave shimmer, and a sub-bass boom.
// Everything scales with `vfx` (0 = Bronze, 1 = Radiant); a tier promotion
// adds an extra octave stab so a new metal/gem lands harder than a division.

/** A short filtered-noise "whoosh" riser — the tension before the chord. */
function riser(c: AudioContext, startAt: number, duration: number, peak: number) {
  const frames = Math.floor(c.sampleRate * duration)
  const buffer = c.createBuffer(1, frames, c.sampleRate)
  const d = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (i / frames) // swell in
  const src = c.createBufferSource()
  src.buffer = buffer
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.9
  bp.frequency.setValueAtTime(300, startAt)
  bp.frequency.exponentialRampToValueAtTime(5000, startAt + duration) // sweep up
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + duration * 0.85)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  src.connect(bp).connect(gain).connect(c.destination)
  src.start(startAt)
  src.stop(startAt + duration + 0.02)
}

/** A deep sub-bass boom — the impact under a big promotion. */
function boom(c: AudioContext, startAt: number, peak: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(120, startAt)
  osc.frequency.exponentialRampToValueAtTime(45, startAt + 0.5) // pitch drop = weight
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.6)
  osc.connect(gain).connect(c.destination)
  osc.start(startAt)
  osc.stop(startAt + 0.65)
}

/**
 * Rank-up fanfare. `vfx` (0..1) scales grandeur; `tierUp` adds the epic layer.
 * Low ranks: a clean bright triad. High ranks: riser + stacked detuned saws +
 * octave shimmer cascade + sub boom — an unmistakable "you climbed" moment.
 */
export function playRankUp(vfx: number, tierUp: boolean): void {
  if (!sfxEnabled()) return
  const c = getCtx()
  if (!c) return
  const t = c.currentTime
  const v = Math.max(0, Math.min(1, vfx))

  // Rising sweep in front — longer and louder the higher you rank.
  riser(c, t, 0.34 + 0.22 * v, 0.05 + 0.09 * v)

  // The chord lands after the riser. Base is a bright major triad; higher
  // tiers stack a fifth and an octave, and gain a saw edge for intensity.
  const hit = t + 0.32 + 0.16 * v
  const root = 523.25 // C5
  const chord = [root, root * 1.26, root * 1.5] // C E G
  if (v >= 0.4) chord.push(root * 2)            // + C6
  if (v >= 0.7) chord.push(root * 2.52, root * 3) // + E6 G6 (full stack)
  const chordType: OscillatorType = v >= 0.5 ? 'sawtooth' : 'triangle'
  chord.forEach((f, i) => {
    note(c, f, hit + i * 0.03, 0.55 + 0.35 * v, { type: chordType, peak: 0.06 + 0.05 * v })
    // Detune a shadow copy for width at higher tiers.
    if (v >= 0.5) note(c, f * 1.006, hit + i * 0.03, 0.5 + 0.3 * v, { type: 'sawtooth', peak: 0.03 + 0.03 * v })
  })

  // Sub-bass impact under the chord — grows with rank.
  if (v >= 0.25) boom(c, hit, 0.1 + 0.16 * v)

  // Shimmer cascade tail — the "shine" of a high rank.
  const shimmerCount = Math.round(2 + v * 5)
  for (let i = 0; i < shimmerCount; i++) {
    note(c, root * (2 + i * 0.5), hit + 0.28 + i * 0.05, 0.4, { peak: 0.02 + 0.03 * v })
  }

  // Tier promotion (new metal/gem): an extra high octave stab so it lands
  // harder than an in-tier division bump.
  if (tierUp) {
    note(c, root * 4, hit + 0.02, 0.5, { type: 'triangle', peak: 0.05 + 0.05 * v })
    if (v >= 0.6) boom(c, hit + 0.28, 0.12 + 0.12 * v) // double-thump on big tiers
  }
}
