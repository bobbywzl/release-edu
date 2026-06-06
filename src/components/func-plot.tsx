'use client'
import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

/**
 * Safe-ish math expression evaluator. Supports:
 *   - +  -  *  /  ^  (power)
 *   - parentheses
 *   - variable: x
 *   - functions: sin, cos, tan, asin, acos, atan, sqrt, abs, exp, ln, log, log2, log10, floor, ceil, round
 *   - constants: pi, e
 *
 * Implementation: rewrite ^ → ** and validate the cleaned string is purely
 * arithmetic/identifiers, then run inside `new Function` with our whitelist
 * bound as parameters. No `eval`, no access to globals.
 */
function compileExpr(expr: string): ((x: number) => number) | null {
  const ALLOWED_NAMES = new Set([
    'x', 'pi', 'e',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
    'sinh', 'cosh', 'tanh',
    'sqrt', 'abs', 'exp', 'ln', 'log', 'log2', 'log10',
    'floor', 'ceil', 'round', 'min', 'max', 'pow', 'sign',
  ])

  // Rewrite caret to JS exponent operator.
  const rewritten = expr.replace(/\^/g, '**')

  // Validate: only allow digits, operators, parens, whitespace, dots, commas,
  // and identifiers from the whitelist.
  const idents = rewritten.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []
  for (const id of idents) {
    if (!ALLOWED_NAMES.has(id)) return null
  }
  if (!/^[0-9A-Za-z_+\-*/().,\s*]+$/.test(rewritten)) return null

  try {
    // Build a function (x, helpers) => expr. ln is mapped to log (natural log
    // in JS Math.log). Provide our shortened aliases.
    const body = `
      const { sin, cos, tan, asin, acos, atan, atan2,
              sinh, cosh, tanh, sqrt, abs, exp, log, log2, log10,
              floor, ceil, round, min, max, pow, sign, PI: pi, E: e } = Math;
      const ln = log;
      return (${rewritten});
    `
    const fn = new Function('x', body) as (x: number) => number
    // Smoke-test at x=0 and x=1.
    fn(0); fn(1)
    return fn
  } catch {
    return null
  }
}

interface FuncPlotSpec {
  fn: ((x: number) => number) | null
  expr: string
  domain: [number, number]
  title: string
  samples: number
}

function parseSpec(raw: string): FuncPlotSpec {
  const functionMatch = raw.match(/FUNCTION:\s*(.+)/i)
  const domainMatch = raw.match(/DOMAIN:\s*\[\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\]/i)
  const titleMatch = raw.match(/TITLE:\s*(.+)/i)
  const samplesMatch = raw.match(/SAMPLES:\s*(\d+)/i)

  const expr = functionMatch?.[1]?.trim() ?? ''
  const domain: [number, number] = domainMatch
    ? [parseFloat(domainMatch[1]), parseFloat(domainMatch[2])]
    : [-10, 10]
  const title = titleMatch?.[1]?.trim() ?? ''
  const samples = Math.max(20, Math.min(400, parseInt(samplesMatch?.[1] ?? '120', 10)))

  return { fn: expr ? compileExpr(expr) : null, expr, domain, title, samples }
}

export function FuncPlot({ raw }: { raw: string }) {
  const spec = useMemo(() => parseSpec(raw), [raw])

  const data = useMemo(() => {
    if (!spec.fn) return []
    const [lo, hi] = spec.domain
    const step = (hi - lo) / spec.samples
    const points: { x: number; y: number | null }[] = []
    for (let i = 0; i <= spec.samples; i++) {
      const x = lo + i * step
      let y: number | null = null
      try {
        const v = spec.fn(x)
        if (Number.isFinite(v)) {
          // Clip extreme values to keep the plot readable.
          if (Math.abs(v) > 1e6) y = null
          else y = v
        }
      } catch { /* skip invalid points */ }
      points.push({ x: Number(x.toFixed(4)), y })
    }
    return points
  }, [spec])

  if (!spec.fn) {
    return (
      <div className="my-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
        Could not plot <code className="font-mono">{spec.expr || '(no function)'}</code> — invalid or unsupported expression.
      </div>
    )
  }

  return (
    <div className="my-3 rounded-lg border border-border/50 bg-card/50 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {spec.title || `y = ${spec.expr}`}
        </p>
        <p className="text-[10px] text-muted-foreground/70 font-mono">
          x ∈ [{spec.domain[0]}, {spec.domain[1]}]
        </p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <XAxis
            dataKey="x"
            type="number"
            domain={spec.domain}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(Math.abs(v) < 1 ? 2 : 1)}
          />
          <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
          <Tooltip
            formatter={(v) => typeof v === 'number' ? v.toFixed(4) : String(v ?? '')}
            labelFormatter={(v) => `x = ${typeof v === 'number' ? v : String(v ?? '')}`}
            contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="2 2" strokeWidth={1} />
          <ReferenceLine x={0} stroke="#6b7280" strokeDasharray="2 2" strokeWidth={1} />
          <Line
            type="monotone"
            dataKey="y"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
