import { describe, expect, it } from 'vitest'
import { awaitingAnswer, canTakeBack, closureProgress, heldBy, leftOverAfter, transferNavText } from './status'

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
