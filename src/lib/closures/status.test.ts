import { describe, expect, it } from 'vitest'
import { awaitingAnswer, canTakeBack, closureProgress, heldBy, leftOverAfter, transferNavText, storeStatus, transferJournalText } from './status'

const req = (id: string, status: 'sent' | 'accepted' | 'declined' | 'received' | 'cancelled') => ({ id, status })
const line = (request_id: string, item_code: string, qty_requested: number, qty_accepted: number | null = null) => ({ request_id, item_code, qty_requested, qty_accepted })

describe('where a closure stands', () => {
  it('counts the requests by what they are up to', () => {
    expect(closureProgress([req('a', 'sent'), req('b', 'accepted'), req('c', 'declined'), req('d', 'received'), req('e', 'cancelled')]))
      .toEqual({ waiting: 1, accepted: 1, declined: 1, received: 1, cancelled: 1, total: 5, allAnswered: false })
  })
  it('is answered once nothing is waiting, and a taken-back request never holds it open', () => {
    expect(closureProgress([req('a', 'accepted'), req('b', 'cancelled')]).allAnswered).toBe(true)
    expect(closureProgress([]).allAnswered).toBe(false)
  })
  it('lets a store answer only while it is waiting, and operations take back only a waiting one', () => {
    expect(awaitingAnswer(req('a', 'sent'))).toBe(true)
    expect(awaitingAnswer(req('a', 'accepted'))).toBe(false)
    expect(canTakeBack(req('a', 'sent'))).toBe(true)
    expect(canTakeBack(req('a', 'received'))).toBe(false)
  })
})

describe('what is left of the sheet', () => {
  const sheet = [{ item_code: 'I1', qty: 20 }, { item_code: 'I2', qty: 10 }, { item_code: 'I3', qty: 5 }]
  it('holds what a waiting request asked for, and what an accepted or received one took', () => {
    expect(heldBy(req('a', 'sent'), line('a', 'I1', 8))).toBe(8)
    expect(heldBy(req('a', 'accepted'), line('a', 'I1', 8, 5))).toBe(5)
    expect(heldBy(req('a', 'received'), line('a', 'I1', 8, 8))).toBe(8)
    expect(heldBy(req('a', 'declined'), line('a', 'I1', 8, 0))).toBe(0)
    expect(heldBy(req('a', 'cancelled'), line('a', 'I1', 8))).toBe(0)
  })
  it('leaves over what no live request holds, the same as the database does', () => {
    const reqs = [req('b', 'received'), req('c', 'declined'), req('d', 'sent'), req('e', 'cancelled')]
    const lines = [line('b', 'I1', 12, 9), line('c', 'I1', 8, 0), line('c', 'I2', 10, 0), line('d', 'I3', 3), line('e', 'I3', 2)]
    const left = leftOverAfter(sheet, reqs, lines)
    expect(left.get('I1')).toBe(11) // 20 less the 9 that was taken
    expect(left.get('I2')).toBe(10) // all of it declined
    expect(left.get('I3')).toBe(2) // 3 of 5 still waiting
  })
  it('never goes below zero, and an item with no requests is all left', () => {
    expect(leftOverAfter([{ item_code: 'I1', qty: 4 }], [req('a', 'sent')], [line('a', 'I1', 9)]).get('I1')).toBe(0)
    expect(leftOverAfter(sheet, [], []).get('I2')).toBe(10)
  })
})

describe('Copy for NAV (transfer)', () => {
  it('writes the item number and accepted quantity, in item order, leaving out zeros', () => {
    expect(transferNavText([line('a', 'B2', 5, 3), line('a', 'A1', 4, 4), line('a', 'C3', 6, 0)])).toBe('A1\t4\nB2\t3')
  })
  it('uses the quantity asked for when nothing has been accepted yet, and keeps leading zeros', () => {
    expect(transferNavText([line('a', '00123', 7)])).toBe('00123\t7')
    expect(transferNavText([])).toBe('')
  })
})

describe('the stock adjustment a store pastes into NAV', () => {
  const date = new Date(2026, 10, 17)
  const ln = (code: string, qty_requested: number, qty_accepted: number | null = null, description = 'Box') => ({ item_code: code, description, qty_requested, qty_accepted })
  it('uses the stock take journal columns, with a positive quantity and no reason code', () => {
    expect(transferJournalText([ln('B2', 5, 3), ln('A1', 4)], date)).toBe('17/11/2026\t\tA1\tBox\tEA\t4\t\n17/11/2026\t\tB2\tBox\tEA\t3\t')
  })
  it('leaves out zeros, keeps leading zeros, and can add the header', () => {
    expect(transferJournalText([ln('00123', 2), ln('C3', 6, 0)], date)).toBe('17/11/2026\t\t00123\tBox\tEA\t2\t')
    expect(transferJournalText([ln('A1', 1)], date, true).split('\n')[0]).toBe('Posting Date\tBarcode\tItem No.\tDescription\tUnit of Measure\tQuantity\tReason Code')
    expect(transferJournalText([], date)).toBe('')
  })
})

describe('what a store sees for a request', () => {
  it('to copy, then copied, then done', () => {
    expect(storeStatus({ status: 'sent', copied_at: null }).label).toBe('To copy into NAV')
    expect(storeStatus({ status: 'accepted', copied_at: '2026-11-17' }).label).toBe('Copied, to mark done')
    expect(storeStatus({ status: 'received', copied_at: '2026-11-17' }).label).toBe('Done')
  })
})
