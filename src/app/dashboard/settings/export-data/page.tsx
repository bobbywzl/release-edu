'use client'
import { useState } from 'react'
import { ArrowLeft, Download, FileJson, FileText, Archive, Check, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/toast'
import Link from 'next/link'

interface ExportOption {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  format: string
  checked: boolean
}

export default function ExportDataPage() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const [format, setFormat] = useState<'json' | 'csv'>('json')

  const [options, setOptions] = useState<ExportOption[]>([
    { id: 'profile', label: 'Profile & Settings', description: 'Your personal info, preferences, and account settings', icon: <FileText className="w-4 h-4" />, format: 'JSON', checked: true },
    { id: 'curriculum', label: 'Curriculum & Roadmap', description: 'Your personalized curriculum plan, modules, and progress', icon: <FileJson className="w-4 h-4" />, format: 'JSON', checked: true },
    { id: 'conversations', label: 'Conversations', description: 'All chat history with your AI mentor', icon: <FileText className="w-4 h-4" />, format: 'JSON', checked: true },
    { id: 'projects', label: 'Projects & Assignments', description: 'Project data, submissions, and assignment history', icon: <Archive className="w-4 h-4" />, format: 'JSON/Files', checked: true },
    { id: 'insights', label: 'AI Insights', description: 'All AI-generated insights about your learning patterns', icon: <FileJson className="w-4 h-4" />, format: 'JSON', checked: false },

    { id: 'activity', label: 'Activity Log', description: 'Login history, session data, and activity timestamps', icon: <FileText className="w-4 h-4" />, format: 'CSV', checked: false },
  ])

  function toggleOption(id: string) {
    setOptions(prev => prev.map(o => o.id === id ? { ...o, checked: !o.checked } : o))
  }

  function selectAll() {
    setOptions(prev => prev.map(o => ({ ...o, checked: true })))
  }

  const selectedCount = options.filter(o => o.checked).length

  async function handleExport() {
    if (selectedCount === 0) {
      toast.error('Nothing selected', 'Please select at least one data type to export.')
      return
    }

    setExporting(true)
    try {
      const selected = options.filter(o => o.checked).map(o => o.id)
      const res = await fetch('/api/account/export-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: selected, format }),
      })

      if (!res.ok) throw new Error('Export failed')

      // Download the file
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `release-edu-export-${new Date().toISOString().split('T')[0]}.${format === 'json' ? 'json' : 'zip'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setExported(true)
      toast.success('Export complete', 'Your data has been downloaded.')
      setTimeout(() => setExported(false), 5000)
    } catch {
      toast.error('Export failed', 'Could not export your data. Please try again.')
    } finally {
      setExporting(false)
    }
  }

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
            <Download className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Export My Data</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Download all your learning data and history</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Format selection */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Export Format</p>
        <div className="flex gap-3">
          {[
            { value: 'json' as const, label: 'JSON', desc: 'Machine-readable, re-importable' },
            { value: 'csv' as const, label: 'CSV / ZIP', desc: 'Spreadsheet-friendly, includes files' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFormat(f.value)}
              className={`flex-1 p-3 rounded-lg border text-left transition-all ${
                format === f.value
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:border-border/80 hover:bg-accent/30'
              }`}
            >
              <p className="text-sm font-medium text-foreground">{f.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Data categories */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Data to Include</p>
          <button
            onClick={selectAll}
            className="text-[11px] text-primary hover:underline"
          >
            Select all
          </button>
        </div>
        <div className="space-y-2">
          {options.map(option => (
            <button
              key={option.id}
              onClick={() => toggleOption(option.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                option.checked
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border hover:bg-accent/30'
              }`}
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                option.checked ? 'bg-primary text-primary-foreground' : 'bg-border'
              }`}>
                {option.checked && <Check className="w-3.5 h-3.5" />}
              </div>
              <div className="w-8 h-8 rounded-md bg-accent/50 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                {option.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="text-[11px] text-muted-foreground">{option.description}</p>
              </div>
              <Badge variant="secondary" className="text-[9px] flex-shrink-0">{option.format}</Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="p-4 rounded-lg bg-accent/30 border border-border/50 flex gap-3">
        <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p>Your data export will be prepared and downloaded immediately. Large exports may take a moment.</p>
          <p>This is your data — you can request it at any time under GDPR, CCPA, and other privacy regulations.</p>
        </div>
      </div>

      {/* Export button */}
      <div className="flex justify-end gap-3">
        <Link href="/dashboard/settings">
          <Button variant="outline">Cancel</Button>
        </Link>
        <Button onClick={handleExport} disabled={exporting || selectedCount === 0}>
          {exporting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Preparing export...
            </span>
          ) : exported ? (
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              Downloaded!
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export {selectedCount} {selectedCount === 1 ? 'category' : 'categories'}
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}
