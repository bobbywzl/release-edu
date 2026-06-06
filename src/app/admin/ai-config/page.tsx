'use client'
import { useState, useEffect } from 'react'
import {
  Settings2, Save, CheckCircle, AlertCircle, Info,
  ChevronDown, ChevronUp, Eye,
} from 'lucide-react'

interface TeacherConfig {
  socraticIntensity: number
  hintLevel: number
  difficultyBias: number
  celebrateMistakes: boolean
  encourageExploration: boolean
  focusTopics: string | null
  restrictedTopics: string | null
  customInstructions: string | null
  tonePreference: string
  maxResponseLength: number
  allowProjectIdeas: boolean
  allowCareerAdvice: boolean
}

const TONE_OPTIONS = [
  { value: 'warm', label: 'Warm', desc: 'Enthusiastic and encouraging' },
  { value: 'professional', label: 'Professional', desc: 'Precise and focused' },
  { value: 'casual', label: 'Casual', desc: 'Relaxed, like a knowledgeable friend' },
  { value: 'strict', label: 'Strict', desc: 'Direct and high-standards' },
]

const CURRICULUM_TOPICS = [
  'algorithms', 'data structures', 'mathematics', 'linear algebra', 'calculus',
  'statistics', 'machine learning', 'databases', 'networking', 'systems programming',
  'OOP', 'web development', 'finance basics', 'investing', 'cognitive psychology',
  'career development', 'project management',
]

function SliderField({
  label,
  description,
  value,
  min = 1,
  max = 10,
  lowLabel,
  highLabel,
  onChange,
}: {
  label: string
  description: string
  value: number
  min?: number
  max?: number
  lowLabel: string
  highLabel: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
          {value}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground w-20 text-right">{lowLabel}</span>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="text-[10px] text-muted-foreground w-20">{highLabel}</span>
      </div>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

function TopicSelector({
  label,
  selected,
  all,
  onChange,
}: {
  label: string
  selected: string[]
  all: string[]
  onChange: (topics: string[]) => void
}) {
  const [custom, setCustom] = useState('')

  function toggle(topic: string) {
    if (selected.includes(topic)) {
      onChange(selected.filter(t => t !== topic))
    } else {
      onChange([...selected, topic])
    }
  }

  function addCustom() {
    const t = custom.trim().toLowerCase()
    if (t && !selected.includes(t)) {
      onChange([...selected, t])
      setCustom('')
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {all.map(topic => (
          <button
            key={topic}
            onClick={() => toggle(topic)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              selected.includes(topic)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:border-primary/40'
            }`}
          >
            {topic}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Add custom topic…"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCustom()}
          className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          onClick={addCustom}
          className="px-3 py-1.5 bg-primary/10 text-primary text-xs rounded-lg hover:bg-primary/20 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}

export default function AIConfigPage() {
  const [config, setConfig] = useState<TeacherConfig>({
    socraticIntensity: 7,
    hintLevel: 5,
    difficultyBias: 5,
    celebrateMistakes: true,
    encourageExploration: true,
    focusTopics: null,
    restrictedTopics: null,
    customInstructions: null,
    tonePreference: 'warm',
    maxResponseLength: 500,
    allowProjectIdeas: true,
    allowCareerAdvice: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    fetch('/api/teacher/config')
      .then(r => r.json())
      .then(data => {
        const d = data as TeacherConfig
        setConfig(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function safeParseArr(str: string | null): string[] {
    if (!str) return []
    try { return JSON.parse(str) as string[] } catch { return [] }
  }

  function setField<K extends keyof TeacherConfig>(key: K, value: TeacherConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/teacher/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError('Failed to save. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const focusTopics = safeParseArr(config.focusTopics)
  const restrictedTopics = safeParseArr(config.restrictedTopics)

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading config…</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Settings2 className="w-6 h-6 text-primary" />
            Architect Bob Configuration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control how Bob mentors your students. Changes apply immediately.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Teaching method */}
      <section className="bg-card border border-border rounded-xl p-6 space-y-6">
        <h2 className="font-semibold text-foreground">Teaching Method</h2>

        <SliderField
          label="Socratic Intensity"
          description="How often Bob asks questions instead of giving direct answers"
          value={config.socraticIntensity}
          lowLabel="Direct answers"
          highLabel="Always questions"
          onChange={v => setField('socraticIntensity', v)}
        />
        <SliderField
          label="Hint Level"
          description="How readily Bob gives hints when students are stuck"
          value={config.hintLevel}
          lowLabel="Let them struggle"
          highLabel="Generous hints"
          onChange={v => setField('hintLevel', v)}
        />
        <SliderField
          label="Difficulty Bias"
          description="Whether to push students harder or keep them in their comfort zone"
          value={config.difficultyBias}
          lowLabel="Comfort zone"
          highLabel="Challenge mode"
          onChange={v => setField('difficultyBias', v)}
        />
        <SliderField
          label="Max Response Length"
          description="Rough word limit for Bob's responses"
          value={config.maxResponseLength}
          min={100}
          max={1000}
          lowLabel="Concise"
          highLabel="Detailed"
          onChange={v => setField('maxResponseLength', v)}
        />
      </section>

      {/* Behavior toggles */}
      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-semibold text-foreground mb-4">Behavior</h2>
        <Toggle
          label="Celebrate Mistakes"
          description={'Bob explicitly celebrates errors as learning moments ("That\'s a great mistake because...")'}
          checked={config.celebrateMistakes}
          onChange={v => setField('celebrateMistakes', v)}
        />
        <Toggle
          label="Encourage Exploration"
          description="Bob actively encourages tangential curiosity and off-topic exploration"
          checked={config.encourageExploration}
          onChange={v => setField('encourageExploration', v)}
        />
        <Toggle
          label="Allow Project Ideas"
          description="Bob can suggest new project ideas relevant to what the student is learning"
          checked={config.allowProjectIdeas}
          onChange={v => setField('allowProjectIdeas', v)}
        />
        <Toggle
          label="Allow Career Advice"
          description="Bob can give career guidance, path recommendations, and industry context"
          checked={config.allowCareerAdvice}
          onChange={v => setField('allowCareerAdvice', v)}
        />
      </section>

      {/* Tone */}
      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-semibold text-foreground mb-4">Tone</h2>
        <div className="grid grid-cols-2 gap-3">
          {TONE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setField('tonePreference', opt.value)}
              className={`p-4 rounded-lg border text-left transition-colors ${
                config.tonePreference === opt.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="font-medium text-sm text-foreground">{opt.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Topics */}
      <section className="bg-card border border-border rounded-xl p-6 space-y-6">
        <h2 className="font-semibold text-foreground">Topics</h2>
        <TopicSelector
          label="Focus Topics (emphasize these)"
          selected={focusTopics}
          all={CURRICULUM_TOPICS}
          onChange={topics => setField('focusTopics', JSON.stringify(topics))}
        />
        <TopicSelector
          label="Restricted Topics (avoid/redirect)"
          selected={restrictedTopics}
          all={CURRICULUM_TOPICS}
          onChange={topics => setField('restrictedTopics', JSON.stringify(topics))}
        />
      </section>

      {/* Custom instructions */}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-semibold text-foreground">Custom Instructions</h2>
          <div className="relative group">
            <Info className="w-4 h-4 text-muted-foreground" />
            <div className="absolute left-0 bottom-6 w-64 bg-popover border border-border rounded-lg p-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              Free-text instructions added directly to Bob&apos;s system prompt. Use this for specific mentoring approaches unique to your class.
            </div>
          </div>
        </div>
        <textarea
          value={config.customInstructions ?? ''}
          onChange={e => setField('customInstructions', e.target.value || null)}
          placeholder="e.g. 'Always connect math concepts to real-world applications. Emphasize visual explanations for CS topics.'"
          rows={4}
          className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
        />
      </section>

      {/* Preview */}
      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowPreview(o => !o)}
          className="w-full flex items-center justify-between p-4 hover:bg-accent transition-colors"
        >
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Eye className="w-4 h-4 text-primary" />
            System Prompt Preview
          </div>
          {showPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showPreview && (
          <div className="p-4 border-t border-border">
            <div className="bg-background rounded-lg p-4 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
              {`Socratic Intensity: ${config.socraticIntensity}/10
Hint Level: ${config.hintLevel}/10
Difficulty Bias: ${config.difficultyBias}/10
Tone: ${config.tonePreference}
Max Response Length: ~${config.maxResponseLength} words
Celebrate Mistakes: ${config.celebrateMistakes ? 'Yes' : 'No'}
Encourage Exploration: ${config.encourageExploration ? 'Yes' : 'No'}
Allow Project Ideas: ${config.allowProjectIdeas ? 'Yes' : 'No'}
Allow Career Advice: ${config.allowCareerAdvice ? 'Yes' : 'No'}
Focus Topics: ${focusTopics.length > 0 ? focusTopics.join(', ') : 'None'}
Restricted Topics: ${restrictedTopics.length > 0 ? restrictedTopics.join(', ') : 'None'}
Custom Instructions: ${config.customInstructions ?? 'None'}`}
            </div>
          </div>
        )}
      </section>

      {/* Bottom save */}
      <div className="flex justify-end pb-6">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-8 py-3 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
