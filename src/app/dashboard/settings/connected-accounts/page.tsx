'use client'
import { useState, useEffect } from 'react'
import { ArrowLeft, Link2, Unlink, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/toast'
import Link from 'next/link'

interface ConnectedAccount {
  provider: string
  label: string
  icon: React.ReactNode
  email?: string
  connected: boolean
  primary?: boolean
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg className="w-5 h-5 text-foreground" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  )
}

export default function ConnectedAccountsPage() {
  const toast = useToast()
  const [loading, setLoading] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<ConnectedAccount[]>([
    {
      provider: 'google',
      label: 'Google',
      icon: <GoogleIcon />,
      connected: false,
      primary: false,
    },
    {
      provider: 'github',
      label: 'GitHub',
      icon: <GitHubIcon />,
      connected: false,
    },
  ])

  // Load connected accounts on mount
  useEffect(() => {
    fetch('/api/account/connected-accounts')
      .then(r => r.json())
      .then(data => {
        if (data.accounts) {
          setAccounts(prev => prev.map(a => {
            const remote = data.accounts.find((ra: { provider: string }) => ra.provider === a.provider)
            return remote
              ? { ...a, connected: true, email: remote.email, primary: remote.primary ?? false }
              : a
          }))
        }
      })
      .catch(() => {})
  }, [])

  async function handleConnect(provider: string) {
    setLoading(provider)
    try {
      // In a real app this would initiate OAuth
      const res = await fetch('/api/account/connected-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', provider }),
      })
      if (!res.ok) throw new Error('Failed to connect')
      const data = await res.json()

      setAccounts(prev => prev.map(a =>
        a.provider === provider ? { ...a, connected: true, email: data.email } : a
      ))
      toast.success(`${provider} connected`, `Your ${provider} account has been linked.`)
    } catch {
      toast.error('Connection failed', `Could not connect ${provider}. Please try again.`)
    } finally {
      setLoading(null)
    }
  }

  async function handleDisconnect(provider: string) {
    const account = accounts.find(a => a.provider === provider)
    if (account?.primary) {
      toast.error('Cannot disconnect', 'This is your primary sign-in method.')
      return
    }

    setLoading(provider)
    try {
      const res = await fetch('/api/account/connected-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect', provider }),
      })
      if (!res.ok) throw new Error('Failed to disconnect')

      setAccounts(prev => prev.map(a =>
        a.provider === provider ? { ...a, connected: false, email: undefined } : a
      ))
      toast.info(`${provider} disconnected`, `Your ${provider} account has been unlinked.`)
    } catch {
      toast.error('Error', `Could not disconnect ${provider}. Please try again.`)
    } finally {
      setLoading(null)
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
            <Link2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Connected Accounts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage linked sign-in providers and services</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Accounts list */}
      <div className="space-y-3">
        {accounts.map(account => (
          <div
            key={account.provider}
            className={`p-4 rounded-xl border transition-all ${
              account.connected
                ? 'border-border bg-card'
                : 'border-dashed border-border/60 bg-card/50'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0">
                {account.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{account.label}</span>
                  {account.connected && (
                    <Badge variant="secondary" className="text-[10px]">
                      <Check className="w-2.5 h-2.5 mr-0.5" />Connected
                    </Badge>
                  )}
                  {account.primary && (
                    <Badge variant="default" className="text-[10px]">Primary</Badge>
                  )}
                </div>
                {account.connected && account.email && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{account.email}</p>
                )}
                {!account.connected && (
                  <p className="text-xs text-muted-foreground mt-0.5">Not connected</p>
                )}
              </div>
              <div>
                {account.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisconnect(account.provider)}
                    disabled={loading === account.provider || account.primary}
                    className={`text-xs ${account.primary ? 'opacity-50 cursor-not-allowed' : 'hover:text-destructive hover:border-destructive/40'}`}
                  >
                    {loading === account.provider ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <><Unlink className="w-3.5 h-3.5 mr-1.5" /> Disconnect</>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleConnect(account.provider)}
                    disabled={loading === account.provider}
                    className="text-xs"
                  >
                    {loading === account.provider ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <><Link2 className="w-3.5 h-3.5 mr-1.5" /> Connect</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info */}
      <div className="p-4 rounded-lg bg-accent/30 border border-border/50">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Connected accounts let you sign in with different providers. Your primary account cannot be disconnected.
          You need at least one connected account to sign in.
        </p>
      </div>
    </div>
  )
}
