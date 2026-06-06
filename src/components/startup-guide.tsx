'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, ChevronRight, X, Sparkles, BookOpen, Target, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import Link from 'next/link'

const stepDefs = [
  { icon: BookOpen, titleKey: 'guide.step1Title', bodyKey: 'guide.step1Body', actionKey: 'guide.viewCurriculum', href: '/dashboard/curriculum' },
  { icon: MessageSquare, titleKey: 'guide.step2Title', bodyKey: 'guide.step2Body', actionKey: 'guide.talkToBob', href: '/dashboard/chat', highlight: true },
  { icon: Sparkles, titleKey: 'guide.step3Title', bodyKey: 'guide.step3Body', actionKey: 'guide.viewCurriculum', href: '/dashboard/curriculum' },
  { icon: Target, titleKey: 'guide.step4Title', bodyKey: 'guide.step4Body', actionKey: 'guide.seeProjects', href: '/dashboard/projects' },
]

export function StartupGuide({ onDismiss }: { onDismiss: () => void }) {
  const t = useT()
  const steps = stepDefs.map(s => ({
    icon: s.icon,
    title: t(s.titleKey),
    description: t(s.bodyKey),
    action: { label: t(s.actionKey), href: s.href },
    highlight: s.highlight,
  }))
  const [currentStep, setCurrentStep] = useState(0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-2 border-foreground/10 rounded-xl p-5 bg-card space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-foreground" />
          <span className="text-sm font-semibold text-foreground">{t('guide.gettingStarted')}</span>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground p-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5">
        {steps.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentStep(i)}
            className={`h-1 rounded-full transition-all ${
              i === currentStep ? 'w-8 bg-foreground' : 'w-4 bg-foreground/20'
            }`}
          />
        ))}
      </div>

      {/* Current step */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          {(() => {
            const step = steps[currentStep]
            const Icon = step.icon
            return (
              <>
                <div className={`flex items-start gap-3 ${step.highlight ? 'p-3 -mx-1 rounded-lg bg-foreground/5 border border-foreground/10' : ''}`}>
                  <div className="w-8 h-8 rounded-lg bg-foreground/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link href={step.action.href} className="flex-1">
                    <Button size="sm" variant={step.highlight ? 'default' : 'outline'} className="w-full text-xs">
                      {step.action.label}
                      <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </Link>

                  {currentStep < steps.length - 1 && (
                    <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setCurrentStep(c => c + 1)}>
                      {t('guide.next')}
                    </Button>
                  )}
                </div>
              </>
            )
          })()}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
