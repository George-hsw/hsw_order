import { describe, expect, it } from 'vitest'
import { readAll } from './readAll'

/** A fake table of `total` numbered rows that counts how many page requests are in flight at once. */
function table(total: number) {
  let inFlight = 0
  let peak = 0
  const build = async (from: number, to: number, count: boolean) => {
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 2))
    inFlight--
    const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i)
    return { data, error: null, count: count ? total : null }
  }
  return { build, peak: () => peak }
}

describe('readAll', () => {
  it('reads every row once, in order', async () => {
    const t = table(4400)
    const rows = await readAll<number>(t.build)
    expect(rows).toHaveLength(4400)
    expect(rows.every((v, i) => v === i)).toBe(true)
  })
  it('never has more than a few pages in flight, however long the list', async () => {
    const t = table(65000)
    const rows = await readAll<number>(t.build)
    expect(rows).toHaveLength(65000)
    expect(t.peak()).toBeLessThanOrEqual(5)
  })
  it('stops at the first page when the list is short, and reports a failing page', async () => {
    expect(await readAll<number>(table(30).build)).toHaveLength(30)
    let n = 0
    await expect(readAll<number>(async (from) => (++n === 3 ? { data: null, error: { message: 'timeout' } } : { data: Array(1000).fill(from), error: null, count: 5000 }))).rejects.toThrow('timeout')
  })
})
