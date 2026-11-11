/** Weekly units as small bars, oldest on the left and the latest week in the accent colour. The bars grow in; the figures are also given in words for screen readers. */
export default function Sparkline({ series, label }: { series: number[]; label: string }) {
  const max = Math.max(1, ...series)
  const w = 4, gap = 1.5, h = 22
  const width = series.length * (w + gap) - gap
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${h}`} width={width} height={h} role="img" aria-label={`${label}: ${series.join(', ')}`}>
      {series.map((n, i) => {
        const bh = n <= 0 ? 1 : Math.max(2, (n / max) * h)
        return <rect key={i} className={i === series.length - 1 ? 'bar last' : 'bar'} style={{ ['--i' as string]: i }} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx="1" />
      })}
    </svg>
  )
}
