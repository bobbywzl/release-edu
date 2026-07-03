'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, LayoutDashboard, BarChart3, Bot,
  FolderOpen, Settings, Zap, X, ArrowRight, BookOpen,
  Hash, Command,
} from 'lucide-react'
import { mockKnowledgeNodes, mockProjects } from '@/lib/mock-data'
import { useT } from '@/lib/i18n'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  action: () => void
  category: string
  keywords?: string[]
}

const SUBJECT_COLORS: Record<string, string> = {
  CS: '#3B82F6', Math: '#8B5CF6', Psychology: '#EC4899',
  Finance: '#F59E0B', General: '#10B981',
}

export function CommandPalette() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  // Build command items
  const buildItems = useCallback((): CommandItem[] => {
    const navigate = (href: string) => () => { router.push(href); setOpen(false) }
    const pages: CommandItem[] = [
      { id: 'nav-dashboard', label: t('nav.dashboard'), description: t('cmd.goOverview'), icon: LayoutDashboard, action: navigate('/dashboard'), category: 'Navigation' },
      { id: 'nav-tree', label: t('nav.tree'), description: t('tree.subtitle'), icon: BookOpen, action: navigate('/dashboard/tree'), category: 'Navigation' },
      { id: 'nav-workspace', label: t('nav.workspace'), description: t('cmd.chatMentor'), icon: Bot, action: navigate('/dashboard/workspace'), category: 'Navigation' },
      { id: 'nav-portfolio', label: t('nav.portfolio'), description: t('cmd.viewStats'), icon: BarChart3, action: navigate('/dashboard/portfolio'), category: 'Navigation' },
      { id: 'nav-settings', label: t('nav.settings'), description: t('cmd.accountPrefs'), icon: Settings, action: navigate('/dashboard/settings'), category: 'Navigation' },
    ]

    return pages
  }, [router, t])

  const allItems = buildItems()

  const filteredItems = query.trim()
    ? allItems.filter(item => {
        const q = query.toLowerCase()
        return (
          item.label.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.keywords?.some(k => k.toLowerCase().includes(q))
        )
      })
    : allItems.filter(item => item.category === 'Navigation')

  // Group by category
  const grouped = filteredItems.reduce<Record<string, CommandItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  // Flat list for keyboard navigation
  const flatItems = Object.values(grouped).flat()

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0) }, [query])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Arrow key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(v => Math.min(v + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(v => Math.max(v - 1, 0))
    } else if (e.key === 'Enter' && flatItems[selectedIndex]) {
      flatItems[selectedIndex].action()
    }
  }

  // Track global flat index
  let flatIdx = 0

  return (
    <>
      {/* Trigger hint */}
      <div className="hidden lg:flex fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 bg-card/90 backdrop-blur-sm border border-border rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all shadow-lg"
        >
          <Command className="w-3.5 h-3.5" />
          <span>{t('cmd.label')}</span>
          <kbd className="ml-1 bg-muted rounded px-1.5 py-0.5 text-[10px] font-mono">⌘K</kbd>
        </button>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={() => setOpen(false)}
            />

            {/* Palette */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -10 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="fixed top-[20vh] left-1/2 -translate-x-1/2 w-full max-w-xl z-50 px-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
                  <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder={t('cmd.placeholder')}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {query && (
                    <button onClick={() => setQuery('')}>
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                  <kbd className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground flex-shrink-0">
                    ESC
                  </kbd>
                </div>

                {/* Results */}
                <div className="max-h-80 overflow-y-auto py-2">
                  {flatItems.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {t('cmd.noResults')} &quot;{query}&quot;
                    </div>
                  ) : (
                    Object.entries(grouped).map(([category, items]) => (
                      <div key={category}>
                        <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {category}
                        </div>
                        {items.map(item => {
                          const isSelected = flatIdx === selectedIndex
                          const currentFlatIdx = flatIdx
                          flatIdx++
                          const color = item.keywords?.includes('CS') ? SUBJECT_COLORS.CS
                            : item.keywords?.includes('Math') ? SUBJECT_COLORS.Math
                            : item.keywords?.includes('Psychology') ? SUBJECT_COLORS.Psychology
                            : item.keywords?.includes('Finance') ? SUBJECT_COLORS.Finance
                            : item.keywords?.includes('General') ? SUBJECT_COLORS.General
                            : undefined
                          return (
                            <button
                              key={item.id}
                              onClick={item.action}
                              onMouseEnter={() => setSelectedIndex(currentFlatIdx)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'
                              }`}
                            >
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-primary/20' : 'bg-muted'}`}
                                style={color ? { backgroundColor: color + '22' } : {}}
                              >
                                {color
                                  ? <Hash className="w-3.5 h-3.5" style={{ color }} />
                                  : <item.icon className={`w-3.5 h-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{item.label}</div>
                                {item.description && (
                                  <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                                )}
                              </div>
                              {isSelected && <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <kbd className="bg-muted rounded px-1 py-0.5 font-mono">↑↓</kbd> {t('cmd.navigate')}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-muted rounded px-1 py-0.5 font-mono">↵</kbd> {t('cmd.open')}
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="bg-muted rounded px-1 py-0.5 font-mono">esc</kbd> {t('cmd.close')}
                  </span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
