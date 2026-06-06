'use client'

import { motion } from 'framer-motion'
import { Target, CheckCircle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface SessionProgressBarProps {
  chapterId: string
  objectives: string[]
  currentScore: number
  objectiveStatuses: Record<string, 'understood' | 'partial' | 'not-understood'>
}

const STATUS_COLORS = {
  understood: 'bg-emerald-500 text-emerald-50 border-emerald-600',
  partial: 'bg-amber-500/80 text-amber-50 border-amber-600',
  'not-understood': 'bg-slate-600 text-slate-300 border-slate-500',
}

export function SessionProgressBar({ objectives, currentScore, objectiveStatuses }: SessionProgressBarProps) {
  const understood = Object.values(objectiveStatuses).filter(s => s === 'understood').length
  const total = objectives.length || 1

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 py-3 bg-card/50 border-b border-border space-y-2"
    >
      {/* Score bar */}
      <div className="flex items-center gap-3">
        <Target className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <Progress value={currentScore} className="h-2 flex-1" />
        <span className="text-xs font-medium text-foreground min-w-[3rem] text-right">{currentScore}%</span>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          {understood}/{total}
        </span>
      </div>

      {/* Objective chips */}
      {objectives.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {objectives.map((obj, i) => {
            const key = `OBJECTIVE_${i + 1}`
            const status = objectiveStatuses[key] || 'not-understood'
            return (
              <span
                key={i}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border font-medium truncate max-w-[200px]',
                  STATUS_COLORS[status],
                )}
                title={obj}
              >
                {obj}
              </span>
            )
          })}
        </div>
      )}
    </motion.div>
  )
}
