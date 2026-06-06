'use client'
import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_CONFIG: Record<ToastType, {
  icon: React.ComponentType<{ className?: string }>
  bg: string
  border: string
  iconColor: string
}> = {
  success: { icon: CheckCircle2, bg: 'bg-green-400/10', border: 'border-green-400/30', iconColor: 'text-green-400' },
  error: { icon: XCircle, bg: 'bg-red-400/10', border: 'border-red-400/30', iconColor: 'text-red-400' },
  warning: { icon: AlertCircle, bg: 'bg-amber-400/10', border: 'border-amber-400/30', iconColor: 'text-amber-400' },
  info: { icon: Info, bg: 'bg-blue-400/10', border: 'border-blue-400/30', iconColor: 'text-blue-400' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = `toast-${++counterRef.current}`
    setToasts(prev => [...prev.slice(-4), { ...opts, id }]) // max 5
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  const success = useCallback((title: string, description?: string) =>
    toast({ type: 'success', title, description }), [toast])
  const error = useCallback((title: string, description?: string) =>
    toast({ type: 'error', title, description }), [toast])
  const warning = useCallback((title: string, description?: string) =>
    toast({ type: 'warning', title, description }), [toast])
  const info = useCallback((title: string, description?: string) =>
    toast({ type: 'info', title, description }), [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map(t => {
            const cfg = TOAST_CONFIG[t.type]
            const Icon = cfg.icon
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 60, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.9 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={`pointer-events-auto flex items-start gap-3 max-w-sm rounded-xl border px-4 py-3 shadow-xl backdrop-blur-sm ${cfg.bg} ${cfg.border} bg-card/95`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${cfg.iconColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{t.title}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="flex-shrink-0 p-0.5 hover:bg-accent rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
