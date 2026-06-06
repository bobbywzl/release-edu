'use client'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { useT } from '@/lib/i18n'

// Rotating messages keep the user reassured during cache-invalidation +
// route-bouncing windows (most notably right after Start Over). New messages
// every ~2.2s so the page never feels frozen.
const RESET_KEYS = ['transition.reset1', 'transition.reset2', 'transition.reset3', 'transition.reset4', 'transition.reset5']
const DEFAULT_KEYS = ['transition.default1', 'transition.default2']

export function TransitionScreen({ variant = 'default' }: { variant?: 'reset' | 'default' }) {
  const t = useT()
  const keys = variant === 'reset' ? RESET_KEYS : DEFAULT_KEYS
  const messages = keys.map(k => t(k))
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (messages.length <= 1) return
    const interval = setInterval(() => {
      setIndex(i => (i + 1) % messages.length)
    }, 2200)
    return () => clearInterval(interval)
  }, [messages.length])

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-6 p-6">
      {/* Animated icon */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        className="relative"
      >
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-primary" />
        </div>
      </motion.div>

      {/* Rotating message */}
      <div className="h-6 relative w-full max-w-md text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 text-sm text-foreground/80"
          >
            {messages[index]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Animated dots */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-primary/60"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  )
}
