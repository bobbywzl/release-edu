'use client'
import { useState, useEffect } from 'react'
import { ArrowLeft, Shield, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/toast'
import Link from 'next/link'

interface PrivacySettings {
  profileVisible: boolean
  showProgress: boolean
  showStreak: boolean
  showProjects: boolean
  allowMentorView: boolean
  allowParentView: boolean
  shareAnalytics: boolean
  aiDataTraining: boolean
}

export default function PrivacyPage() {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [settings, setSettings] = useState<PrivacySettings>({
    profileVisible: true,
    showProgress: true,
    showStreak: true,
    showProjects: false,
    allowMentorView: true,
    allowParentView: true,
    shareAnalytics: false,
    aiDataTraining: false,
  })

  useEffect(() => {
    fetch('/api/account/privacy')
      .then(r => r.json())
      .then(data => {
        if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }))
      })
      .catch(() => {})
  }, [])

  function toggle(key: keyof PrivacySettings) {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/account/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
      toast.success('Privacy settings saved')
      setTimeout(() => setSaved(false), 3000)
    } catch {
      toast.error('Error', 'Could not save privacy settings.')
    } finally {
      setSaving(false)
    }
  }

  const sections: {
    title: string
    description?: string
    items: { key: keyof PrivacySettings; label: string; desc: string }[]
  }[] = [
    {
      title: 'Profile Visibility',
      description: 'Control what others can see about you.',
      items: [
        { key: 'profileVisible', label: 'Public Profile', desc: 'Allow others to see your profile page' },
        { key: 'showProgress', label: 'Show Progress', desc: 'Display your learning progress on your profile' },
        { key: 'showStreak', label: 'Show Streak', desc: 'Display your current streak on your profile' },
        { key: 'showProjects', label: 'Show Projects', desc: 'Display your projects publicly' },
      ],
    },
    {
      title: 'Access & Sharing',
      description: 'Control who can view your learning data.',
      items: [
        { key: 'allowMentorView', label: 'Mentor Access', desc: 'Allow your Mentor to view your curriculum, progress, and conversations' },
        { key: 'allowParentView', label: 'Parent/Guardian Access', desc: 'Allow your parent/guardian to view your progress and weekly reports' },
      ],
    },
    {
      title: 'Data & Analytics',
      description: 'Control how your data is used.',
      items: [
        { key: 'shareAnalytics', label: 'Usage Analytics', desc: 'Share anonymous usage data to help improve Release EDU' },
        { key: 'aiDataTraining', label: 'AI Training Data', desc: 'Allow your anonymized conversations to improve our AI mentor' },
      ],
    },
  ]

  return (
    <div className="p-8 lg:p-12 max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Settings
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Privacy Settings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Control what others can see about your profile</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Settings sections */}
      {sections.map((section, si) => (
        <section key={section.title} className="space-y-4">
          {si > 0 && <Separator />}
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{section.title}</h2>
            {section.description && (
              <p className="text-xs text-muted-foreground mt-1">{section.description}</p>
            )}
          </div>
          {section.items.map((item, i) => (
            <div key={item.key}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{item.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
                </div>
                <Switch checked={settings[item.key]} onCheckedChange={() => toggle(item.key)} />
              </div>
            </div>
          ))}
        </section>
      ))}

      {/* Info */}
      <div className="p-4 rounded-lg bg-accent/30 border border-border/50">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your privacy matters. These settings control what is shared with other users, mentors, and our platform.
          You can change these at any time. For data deletion, visit the{' '}
          <Link href="/dashboard/settings/delete-account" className="text-primary hover:underline">Delete Account</Link> page.
        </p>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-3">
        <Link href="/dashboard/settings">
          <Button variant="outline">Cancel</Button>
        </Link>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : saved ? (
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4" /> Saved!
            </span>
          ) : (
            'Save Privacy Settings'
          )}
        </Button>
      </div>
    </div>
  )
}
