import { describe, expect, it } from 'vitest'
import { allocate, byItem, byStore, reconcile, summary, totals, type Alloc, type ClosingLine, type NeedLine } from './allocate'

const given = (a: Alloc, store: string, code: string) => a.get(store)?.get(code) ?? 0
const plain = (r: ReturnType<typeof allocate>) => JSON.stringify({
  alloc: [...r.alloc].sort().map(([s, m]) => [s, [...m].sort()]),
  left: [...r.left].sort(),
})
const need = (store: string, code: string, shortfall: number): NeedLine => ({ store, code, shortfall })

// Small seeded generator (mulberry32) so a failing run can be repeated.
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('allocate', () => {
  it('gives each store its full shortfall when there is enough, and the rest is left over', () => {
    const r = allocate([{ code: 'A', qty: 20 }], [need('S1', 'A', 5), need('S2', 'A', 7)], ['S1', 'S2'])
    expect(given(r.alloc, 'S1', 'A')).toBe(5)
    expect(given(r.alloc, 'S2', 'A')).toBe(7)
    expect(r.left.get('A')).toBe(8)
  })

  it('qty equal to the total shortfall leaves nothing', () => {
    const r = allocate([{ code: 'A', qty: 12 }], [need('S1', 'A', 5), need('S2', 'A', 7)], ['S1', 'S2'])
    expect(r.left.get('A')).toBe(0)
  })

  it('shares in proportion, within one unit of the exact share', () => {
    const r = allocate([{ code: 'A', qty: 10 }], [need('S1', 'A', 30), need('S2', 'A', 20), need('S3', 'A', 50)], ['S1', 'S2', 'S3'])
    expect(given(r.alloc, 'S1', 'A')).toBe(3)
    expect(given(r.alloc, 'S2', 'A')).toBe(2)
    expect(given(r.alloc, 'S3', 'A')).toBe(5)
    expect(r.left.get('A')).toBe(0)
  })

  it('largest remainder gets the spare unit', () => {
    // 5 units over shortfalls 1, 1, 2 of 4: exact 1.25, 1.25, 2.5 -> floors 1, 1, 2, spare to S3 (.5)
    const r = allocate([{ code: 'A', qty: 5 }], [need('S1', 'A', 3), need('S2', 'A', 3), need('S3', 'A', 6)], ['S1', 'S2', 'S3'])
    expect([given(r.alloc, 'S1', 'A'), given(r.alloc, 'S2', 'A'), given(r.alloc, 'S3', 'A')]).toEqual([1, 1, 3])
  })

  it('ties go to the larger shortfall, then to the store id', () => {
    // 1 unit, shortfalls 2 and 2: equal fractions and shortfalls, so the lower store id wins
    const a = allocate([{ code: 'A', qty: 1 }], [need('S2', 'A', 2), need('S1', 'A', 2)], ['S1', 'S2'])
    expect(given(a.alloc, 'S1', 'A')).toBe(1)
    expect(given(a.alloc, 'S2', 'A')).toBe(0)
    // 1 unit, shortfalls 1 and 2 of 3 with qty 2: exact 0.67 and 1.33 -> floors 0, 1, spare to S1 (.67)
    const b = allocate([{ code: 'A', qty: 2 }], [need('S1', 'A', 1), need('S2', 'A', 2)], ['S1', 'S2'])
    expect([given(b.alloc, 'S1', 'A'), given(b.alloc, 'S2', 'A')]).toEqual([1, 1])
    // equal fractions, different shortfalls: 3 units over 2, 4, 6 of 12 -> 0.5, 1, 1.5: floors 0, 1, 1, spare to S3 (.5 ties S1 at .5; larger shortfall wins)
    const c = allocate([{ code: 'A', qty: 3 }], [need('S1', 'A', 2), need('S2', 'A', 4), need('S3', 'A', 6)], ['S1', 'S2', 'S3'])
    expect([given(c.alloc, 'S1', 'A'), given(c.alloc, 'S2', 'A'), given(c.alloc, 'S3', 'A')]).toEqual([0, 1, 2])
  })

  it('is deterministic: same input twice, and any store order, gives the same answer', () => {
    const closing: ClosingLine[] = [{ code: 'A', qty: 7 }, { code: 'B', qty: 4 }]
    const rows = [need('S1', 'A', 2), need('S2', 'A', 2), need('S3', 'A', 2), need('S1', 'B', 1), need('S3', 'B', 5)]
    const one = plain(allocate(closing, rows, ['S1', 'S2', 'S3']))
    expect(plain(allocate(closing, rows, ['S1', 'S2', 'S3']))).toBe(one)
    expect(plain(allocate(closing, rows, ['S3', 'S1', 'S2']))).toBe(one)
    expect(plain(allocate([...closing].reverse(), [...rows].reverse(), ['S2', 'S3', 'S1']))).toBe(one)
  })

  it('a store with no need row for an item gets none', () => {
    const r = allocate([{ code: 'A', qty: 10 }], [need('S1', 'A', 4)], ['S1', 'S2'])
    expect(given(r.alloc, 'S2', 'A')).toBe(0)
    expect(given(r.alloc, 'S1', 'A')).toBe(4)
    expect(r.left.get('A')).toBe(6)
  })

  it('stores not taking part are ignored', () => {
    const r = allocate([{ code: 'A', qty: 10 }], [need('S1', 'A', 4), need('S9', 'A', 100)], ['S1'])
    expect(r.alloc.has('S9')).toBe(false)
    expect(r.left.get('A')).toBe(6)
  })

  it('zero shortfall everywhere leaves everything over', () => {
    const r = allocate([{ code: 'A', qty: 9 }], [need('S1', 'A', 0), need('S2', 'A', 0)], ['S1', 'S2'])
    expect(r.left.get('A')).toBe(9)
    expect(given(r.alloc, 'S1', 'A') + given(r.alloc, 'S2', 'A')).toBe(0)
  })

  it('an item nobody needs is left over', () => {
    const r = allocate([{ code: 'A', qty: 3 }], [], ['S1'])
    expect(r.left.get('A')).toBe(3)
  })

  it('a single store takes up to its shortfall', () => {
    expect(allocate([{ code: 'A', qty: 3 }], [need('S1', 'A', 8)], ['S1']).alloc.get('S1')!.get('A')).toBe(3)
    const r = allocate([{ code: 'A', qty: 30 }], [need('S1', 'A', 8)], ['S1'])
    expect(r.alloc.get('S1')!.get('A')).toBe(8)
    expect(r.left.get('A')).toBe(22)
  })

  it('ignores items with no quantity', () => {
    const r = allocate([{ code: 'A', qty: 0 }, { code: 'B', qty: -2 }], [need('S1', 'A', 5), need('S1', 'B', 5)], ['S1'])
    expect(r.left.size).toBe(0)
    expect(r.alloc.get('S1')!.size).toBe(0)
  })
})

describe('allocate: randomised invariants', () => {
  it('holds over 300 seeded inputs', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed)
      const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
      const stores = Array.from({ length: int(1, 8) }, (_, i) => `S${i + 1}`)
      const codes = Array.from({ length: int(1, 6) }, (_, i) => `C${i + 1}`)
      const closing = codes.map((code) => ({ code, qty: int(-1, 60) }))
      const rows: NeedLine[] = []
      for (const code of codes) for (const store of stores) if (rand() < 0.7) rows.push(need(store, code, int(0, 40)))
      const r = allocate(closing, rows, stores)
      const ctx = `seed ${seed}`

      expect(plain(allocate(closing, rows, [...stores].reverse())), ctx).toBe(plain(r))
      expect(reconcile(r.alloc, closing), ctx).toEqual([])

      for (const { code, qty } of closing) {
        if (qty <= 0) { expect(r.left.has(code), ctx).toBe(false); continue }
        const sf = new Map<string, number>()
        for (const n of rows) if (n.code === code) sf.set(n.store, (sf.get(n.store) ?? 0) + n.shortfall)
        const S = [...sf.values()].reduce((x, y) => x + y, 0)
        let sum = 0
        for (const store of stores) {
          const q = given(r.alloc, store, code)
          const s = sf.get(store) ?? 0
          expect(Number.isInteger(q), ctx).toBe(true)
          expect(q, ctx).toBeGreaterThanOrEqual(0)
          expect(q, ctx).toBeLessThanOrEqual(s)
          if (S > 0 && qty < S) expect(Math.abs(q - (qty * s) / S), ctx).toBeLessThan(1)
          if (S > 0 && qty >= S) expect(q, ctx).toBe(s)
          sum += q
        }
        expect(sum, ctx).toBeLessThanOrEqual(qty)
        expect(sum + (r.left.get(code) ?? 0), ctx).toBe(qty)
        expect(sum, ctx).toBe(Math.min(qty, S))
      }
    }
  })
})

describe('summary', () => {
  const closing: ClosingLine[] = [{ code: 'A', qty: 10 }, { code: 'B', qty: 5 }]
  const cost = new Map([['A', 2], ['B', 10]])
  it('counts items, units, value at cost and percent allocated', () => {
    const r = allocate(closing, [need('S1', 'A', 4), need('S1', 'B', 5)], ['S1'])
    const s = summary(r.alloc, closing, cost)
    expect(s).toMatchObject({ items: 2, units: 15, allocated: 9, left: 6, valueAllocated: 58, valueLeft: 12, valueTotal: 70, pctAllocated: 60 })
    expect(totals(r.alloc, closing, cost)).toEqual(s)
  })
  it('an item with no cost counts as nothing, and an empty sheet is 0%', () => {
    const r = allocate([{ code: 'Z', qty: 4 }], [need('S1', 'Z', 4)], ['S1'])
    expect(summary(r.alloc, [{ code: 'Z', qty: 4 }], new Map()).valueAllocated).toBe(0)
    expect(summary(new Map(), [], cost).pctAllocated).toBe(0)
  })
})

describe('views', () => {
  const closing: ClosingLine[] = [{ code: 'A', qty: 10 }, { code: 'B', qty: 3 }]
  const rows = [need('S1', 'A', 4), need('S2', 'A', 8), need('S1', 'B', 2)]
  const r = allocate(closing, rows, ['S1', 'S2'])

  it('byStore lists each store\'s lines with shortfall and suggestion', () => {
    const v = byStore(r.alloc, rows)
    expect(v.map((s) => s.store)).toEqual(['S1', 'S2'])
    expect(v[0].lines).toEqual([
      { code: 'A', qty: 3, shortfall: 4, suggested: 3, over: false },
      { code: 'B', qty: 2, shortfall: 2, suggested: 2, over: false },
    ])
    expect(v[0].units).toBe(5)
  })

  it('byStore flags a quantity above the shortfall and keeps the original suggestion', () => {
    const edited: Alloc = new Map([['S1', new Map([['A', 6]])], ['S2', new Map()]])
    const v = byStore(edited, rows, r.alloc)
    expect(v[0].lines[0]).toMatchObject({ code: 'A', qty: 6, suggested: 3, shortfall: 4, over: true })
  })

  it('byItem shows closing, each store and what is left', () => {
    const v = byItem(r.alloc, rows, closing)
    expect(v.map((i) => i.code)).toEqual(['A', 'B'])
    expect(v[0]).toMatchObject({ closing: 10, allocated: 10, left: 0, overAllocated: false, anyOver: false })
    expect(v[1]).toMatchObject({ closing: 3, allocated: 2, left: 1 })
  })

  it('byItem flags an over-allocated item and a store over its shortfall', () => {
    const edited: Alloc = new Map([['S1', new Map([['A', 9]])], ['S2', new Map([['A', 4]])]])
    const a = byItem(edited, rows, closing)[0]
    expect(a.overAllocated).toBe(true)
    expect(a.anyOver).toBe(true)
    expect(a.left).toBe(-3)
    expect(a.stores.find((s) => s.store === 'S1')!.over).toBe(true)
  })
})

describe('reconcile', () => {
  const closing: ClosingLine[] = [{ code: 'A', qty: 5 }]
  it('is empty for a fair allocation', () => {
    expect(reconcile(new Map([['S1', new Map([['A', 5]])]]), closing)).toEqual([])
  })
  it('reports an over-allocated item', () => {
    const p = reconcile(new Map([['S1', new Map([['A', 3]])], ['S2', new Map([['A', 3]])]]), closing)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ kind: 'over-allocated', code: 'A' })
  })
  it('reports fractional and negative quantities', () => {
    const p = reconcile(new Map([['S1', new Map([['A', 1.5]])], ['S2', new Map([['A', -1]])]]), closing)
    expect(p.map((x) => x.kind)).toEqual(['bad-qty', 'bad-qty'])
  })
  it('reports an item that is not on the closing sheet', () => {
    expect(reconcile(new Map([['S1', new Map([['Q', 1]])]]), closing)[0]).toMatchObject({ kind: 'over-allocated', code: 'Q' })
  })
})
