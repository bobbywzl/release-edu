'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const mdComponents = {
  code({ children, className }: { children?: React.ReactNode; className?: string }) {
    const isInline = !className
    return isInline ? (
      <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-primary">
        {children}
      </code>
    ) : (
      <pre className="bg-muted rounded-lg p-3 overflow-x-auto my-3">
        <code className="text-xs font-mono text-foreground">{children}</code>
      </pre>
    )
  },
  strong({ children }: { children?: React.ReactNode }) {
    return <strong className="font-semibold text-foreground">{children}</strong>
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="mb-3 last:mb-0 leading-relaxed text-sm text-muted-foreground">{children}</p>
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 className="text-base font-semibold text-foreground mt-6 mb-2">{children}</h2>
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 className="text-sm font-semibold text-foreground mt-4 mb-2">{children}</h3>
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="my-2 space-y-1 list-disc list-inside">{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="my-2 space-y-1 list-decimal list-inside">{children}</ol>
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="text-sm text-muted-foreground">{children}</li>
  },
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={mdComponents as Parameters<typeof ReactMarkdown>[0]['components']}
    >
      {content}
    </ReactMarkdown>
  )
}
