'use client'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const CHART_COLORS = ['#6366f1', '#22d3ee', '#a78bfa', '#34d399', '#f59e0b']

export function DataChart({ raw }: { raw: string }) {
  let type = 'bar',
    title = '',
    data: { name: string; value: number }[] = []
  try {
    const typeMatch = raw.match(/TYPE:\s*(\w+)/)
    const titleMatch = raw.match(/TITLE:\s*(.+)/)
    const dataMatch = raw.match(/DATA:\s*(\[[\s\S]*?\])/)
    type = typeMatch?.[1]?.toLowerCase() ?? 'bar'
    title = titleMatch?.[1]?.trim() ?? ''
    data = dataMatch ? JSON.parse(dataMatch[1]) : []
  } catch {
    return null
  }
  if (!data.length) return null

  return (
    <div className="my-3 rounded-lg border border-border/50 bg-card/50 p-4">
      {title && (
        <p className="text-xs font-semibold text-muted-foreground mb-3">
          {title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={200}>
        {type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              label
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : type === 'line' ? (
          <LineChart data={data}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
