import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { compact, pctText } from './lib/sales/model'

// Hand-built SVG and HTML charts for the Sales tab. Colours come from the design tokens only (see the .viz rules in styles.css):
// this year is the brand teal, last year the muted neutral. Every chart has a hover read-out, a keyboard path and a table view.

export type Tone = 'ty' | 'ly'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** A tidy top value for an axis: 1, 2, 4, 6, 8 or 10 times (so four gridlines land on round numbers) a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 6 ? 6 : f <= 8 ? 8 : 10) * p
}

export function Legend({ items }: { items: { tone: Tone; label: string }[] }) {
  return (
    <ul className="viz-legend" aria-label="Legend">
      {items.map((i) => <li key={i.label}><span className={`sw ${i.tone}`} aria-hidden="true" />{i.label}</li>)}
    </ul>
  )
}

// ---------- Delta and stat tile ----------

/** Up or down on last year, as an arrow and words so it never relies on colour alone. */
export function Delta({ f, label = 'on last year' }: { f: number | null; label?: string }) {
  if (f === null) return <span className="delta flat">No comparison</span>
  const dir = f > 0.0005 ? 'up' : f < -0.0005 ? 'down' : 'flat'
  return <span className={`delta ${dir}`}><span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}</span> {pctText(f)} <small>{label}</small></span>
}

export function StatTile({ label, value, ly, delta, note }: { label: string; value: string; ly?: string; delta?: number | null; note?: ReactNode }) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {delta !== undefined && <Delta f={delta} />}
      {ly && <p className="stat-ly">{ly}</p>}
      {note && <p className="stat-ly">{note}</p>}
    </div>
  )
}

// ---------- Chart card with a chart / table switch ----------

export interface TableData { head: string[]; rows: (string | number)[][] }

export function ChartCard({ title, sub, legend, table, children, actions }: { title: string; sub?: string; legend?: ReactNode; table: TableData; children: ReactNode; actions?: ReactNode }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <section className="sheet viz-card">
      <div className="viz-head">
        <div><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</div>
        <div className="viz-tools">
          {actions}
          <div className="segmented" role="group" aria-label={`${title} view`}>
            <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          </div>
        </div>
      </div>
      {legend}
      {view === 'chart' ? children : (
        <div className="tablewrap">
          <table className="viz-table">
            <thead><tr>{table.head.map((h, i) => <th key={h} className={i ? 'r' : ''}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'r' : ''}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------- Grouped column chart ----------

export interface ColumnSeries { name: string; tone: Tone; values: number[] }

export function ColumnChart({ cats, series, fmt, selected, onSelect, height = 232, label }: {
  cats: string[]; series: ColumnSeries[]; fmt: (n: number) => string; selected?: number | null; onSelect?: (i: number) => void; height?: number; label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const L = 46, R = 6, T = 10, B = 26
  const iw = Math.max(0, width - L - R), ih = height - T - B
  const top = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.values))), [series])
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const band = cats.length ? iw / cats.length : 0
  const gap = 2
  const barW = Math.max(3, Math.min(26, (band * 0.78 - gap * (series.length - 1)) / series.length))
  const y = (v: number) => T + ih - (v / top) * ih
  const step = Math.max(1, Math.ceil(46 / Math.max(band, 1)))
  const active = hover ?? null
  // On a touch screen there is no pointer-leave, so a tap anywhere else puts the read-out away.
  useEffect(() => {
    if (hover === null) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setHover(null) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [hover, ref])
  const cx = (i: number) => L + band * (i + 0.5)

  // A bar with its top corners rounded, anchored to the baseline.
  const bar = (x: number, v: number) => {
    const h = Math.max(v > 0 ? 1 : 0, (v / top) * ih)
    const r = Math.min(4, barW / 2, h)
    const y0 = T + ih
    return `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + barW - r} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r} V${y0} Z`
  }
  const tipX = active === null ? 0 : Math.min(Math.max(cx(active), 92), Math.max(92, width - 92))

  return (
    <div className="viz-plot" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={L} x2={width - R} y1={y(t)} y2={y(t)} />
              <text className="axis" x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{compact(t)}</text>
            </g>
          ))}
          {cats.map((c, i) => {
            const x0 = cx(i) - (barW * series.length + gap * (series.length - 1)) / 2
            return (
              <g key={c + i} className={`col${selected === i ? ' on' : ''}${active === i ? ' hot' : ''}`} tabIndex={0} role="button" aria-pressed={selected === i}
                aria-label={`${c}: ${series.map((s) => `${s.name} ${fmt(s.values[i])}`).join(', ')}`}
                onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                onClick={() => onSelect?.(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(i) } }}>
                <rect className="hit" x={L + band * i} y={T} width={band} height={ih + B} />
                {series.map((s, k) => <path key={s.name} className={`bar ${s.tone}`} d={bar(x0 + k * (barW + gap), s.values[i] ?? 0)} />)}
                {i % step === 0 && <text className="axis" x={cx(i)} y={height - 8} textAnchor="middle">{c}</text>}
              </g>
            )
          })}
        </svg>
      )}
      {active !== null && (
        <div className="viz-tip" style={{ left: tipX, top: 0 }} role="status">
          <b>{cats[active]}</b>
          {series.map((s) => <p key={s.name}><span className={`sw ${s.tone}`} aria-hidden="true" />{s.name}<span>{fmt(s.values[active] ?? 0)}</span></p>)}
        </div>
      )}
    </div>
  )
}

// ---------- Horizontal bars: rankings and top lists ----------

export interface BarRow { key: string; label: string; sub?: string; value: number; compare?: number; text: string; tone?: Tone }

export function BarList({ rows, selected, onSelect, tone = 'ty', empty = 'Nothing to show.' }: { rows: BarRow[]; selected?: string | null; onSelect?: (key: string) => void; tone?: Tone; empty?: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.value, r.compare ?? 0]))
  if (!rows.length) return <p className="muted viz-empty">{empty}</p>
  return (
    <ul className="barlist">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="bl-label"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
            <span className="bl-track" aria-hidden="true">
              <span className={`bl-fill ${r.tone ?? tone}`} style={{ transform: `scaleX(${Math.max(0, r.value) / max})` }} />
              {r.compare !== undefined && <span className="bl-mark" style={{ left: `${(Math.max(0, r.compare) / max) * 100}%` }} />}
            </span>
            <span className="bl-value">{r.text}</span>
          </>
        )
        return (
          <li key={r.key}>
            {onSelect
              ? <button type="button" className={`bl-row${selected === r.key ? ' on' : ''}`} aria-pressed={selected === r.key} onClick={() => onSelect(r.key)}>{inner}</button>
              : <div className="bl-row">{inner}</div>}
          </li>
        )
      })}
    </ul>
  )
}

// ---------- Donut ----------

export interface DonutPart { key: string; label: string; value: number; tone: Tone }

export function Donut({ parts, centre, sub, fmt, selected, onSelect, size = 168 }: {
  parts: DonutPart[]; centre: string; sub: string; fmt: (n: number) => string; selected?: string | null; onSelect?: (key: string) => void; size?: number
}) {
  const [hover, setHover] = useState<string | null>(null)
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0)
  const sw = 22, r = (size - sw) / 2, c = 2 * Math.PI * r, mid = size / 2
  const gapLen = parts.length > 1 ? 3 : 0 // the 2px surface gap between segments, plus the line ends
  let offset = 0
  const shown = hover ?? selected ?? null
  const part = parts.find((p) => p.key === shown)
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label={`${sub}: ${parts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}`}>
        <circle className="donut-base" cx={mid} cy={mid} r={r} strokeWidth={sw} fill="none" />
        {total > 0 && parts.map((p) => {
          const len = (Math.max(0, p.value) / total) * c
          const seg = (
            <circle key={p.key} className={`donut-seg ${p.tone}${shown === p.key ? ' on' : ''}`} cx={mid} cy={mid} r={r} fill="none" strokeWidth={sw}
              strokeDasharray={`${Math.max(0, len - gapLen)} ${c}`} strokeDashoffset={-offset} transform={`rotate(-90 ${mid} ${mid})`}
              tabIndex={0} role="button" aria-pressed={selected === p.key} aria-label={`${p.label}: ${fmt(p.value)}`}
              onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)}
              onClick={() => onSelect?.(p.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.key) } }} />
          )
          offset += len
          return seg
        })}
        <text className="donut-big" x={mid} y={mid - 2} textAnchor="middle" dominantBaseline="middle">{part ? fmt(part.value) : centre}</text>
        <text className="axis" x={mid} y={mid + 20} textAnchor="middle">{part ? part.label : sub}</text>
      </svg>
      <ul className="donut-key">
        {parts.map((p) => (
          <li key={p.key}>
            <button type="button" className={shown === p.key ? 'on' : ''} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(p.key)} onBlur={() => setHover(null)} onClick={() => onSelect?.(p.key)}>
              <span className={`sw ${p.tone}`} aria-hidden="true" />{p.label}<b>{total > 0 ? Math.round((p.value / total) * 100) : 0}%</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Rank meter ----------

/** Where a store sits in the league: the fill is how many stores it is ahead of. */
export function Meter({ rank, of, label, text, selected, onSelect }: { rank: number; of: number; label: string; text: string; selected?: boolean; onSelect?: () => void }) {
  const ahead = of > 1 ? (of - rank) / (of - 1) : 1
  const body = (
    <>
      <span className="mt-label">{label}</span>
      <span className="mt-track" aria-hidden="true"><span className="mt-fill" style={{ transform: `scaleX(${Math.max(0.03, ahead)})` }} /></span>
      <span className="mt-value">{text}</span>
    </>
  )
  return onSelect ? <button type="button" className={`meter${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onSelect}>{body}</button> : <div className="meter">{body}</div>
}

/** Dismisses with Escape. */
export function useEscapeKey(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [on, close])
}
