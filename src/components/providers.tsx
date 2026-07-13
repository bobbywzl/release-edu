'use client'
import { SessionProvider } from 'next-auth/react'
import { createContext, useContext } from 'react'
import { ToastProvider } from '@/components/toast'
import { LanguageProvider } from '@/lib/i18n'

const ThemeContext = createContext<{ theme: 'dark'; toggleTheme: () => void }>({ theme: 'dark', toggleTheme: () => {} })

export function useTheme() { return useContext(ThemeContext) }

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LanguageProvider>
        <ThemeContext.Provider value={{ theme: 'dark', toggleTheme: () => {} }}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeContext.Provider>
      </LanguageProvider>
    </SessionProvider>
  )
}
