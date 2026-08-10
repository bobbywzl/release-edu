import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './mobile.css'
import { AccountSlotGate } from '@/components/account-slots'
import { XpToastProvider } from '@/components/xp-toast'
import { DailyCheckin } from '@/components/daily-checkin'

// The mobile app speaks the design system's Inter, self-hosted at build.
const inter = Inter({ subsets: ['latin'], variable: '--font-m' })

export const metadata: Metadata = {
  title: 'Tree EDU',
  description: 'Your trees, checkpoints and reviews — on the go.',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccountSlotGate>
      <div className={`m-root ${inter.variable}`}>
        {children}
        <XpToastProvider />
        <DailyCheckin />
      </div>
    </AccountSlotGate>
  )
}
