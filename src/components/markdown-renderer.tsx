'use client'

/**
 * Shared markdown renderer — Release-EDU-grade reading typography.
 * Titles, subtitles, and content blocks get real hierarchy; body text is
 * full-contrast and comfortably sized (never small gray). KaTeX enabled.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

const mdComponents = {
  code({ children, className }: { children?: React.ReactNode; className?: string }) {
    const isInline = !className
    return isInline ? (
      <code className="bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono text-primary">
        {children}
      </code>
    ) : (
      <pre className="bg-muted rounded-lg p-3 overflow-x-auto my-3">
        <code className="text-[13px] font-mono text-foreground">{children}</code>
      </pre>
    )
  },
  strong({ children }: { children?: React.ReactNode }) {
    return <strong className="font-bold text-foreground">{children}</strong>
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="mb-3 last:mb-0 leading-relaxed text-[15px] text-foreground/90">{children}</p>
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 className="text-xl font-bold text-foreground mt-5 first:mt-0 mb-3 pb-1.5 border-b border-border/60">{children}</h1>
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 className="text-lg font-bold text-foreground mt-5 first:mt-0 mb-2">{children}</h2>
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 className="text-[15px] font-bold text-primary mt-4 first:mt-0 mb-1.5">{children}</h3>
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="my-2.5 space-y-1.5 list-disc pl-5">{children}</ul>
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="my-2.5 space-y-1.5 list-decimal pl-5">{children}</ol>
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="text-[15px] text-foreground/90 leading-relaxed">{children}</li>
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return (
      <blockquote className="my-3 border-l-2 border-primary/50 bg-primary/[0.06] rounded-r-lg pl-3.5 pr-3 py-2 text-[15px] text-foreground/85">
        {children}
      </blockquote>
    )
  },
  table({ children }: { children?: React.ReactNode }) {
    return <div className="overflow-x-auto my-3"><table className="text-sm border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:bg-muted [&_th]:text-foreground [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-foreground/90">{children}</table></div>
  },
  hr() {
    return <hr className="my-4 border-border/60" />
  },
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={mdComponents as Parameters<typeof ReactMarkdown>[0]['components']}
    >
      {content}
    </ReactMarkdown>
  )
}
