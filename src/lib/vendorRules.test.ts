import { describe, expect, it } from 'vitest'
import { noOrderReason } from './vendorRules'

describe('items a vendor does not allow ordering', () => {
  it('blocks TOS items from My Home Storage, whatever the case or spacing', () => {
    expect(noOrderReason('MYHO001', 'TOS')).toBe('My Home Storage items with status TOS cannot be ordered.')
    expect(noOrderReason('myho001', ' tos ')).not.toBeNull()
  })
  it('leaves other statuses and other vendors alone', () => {
    expect(noOrderReason('MYHO001', 'ACTIVE')).toBeNull()
    expect(noOrderReason('MYHO001', 'NEW')).toBeNull()
    expect(noOrderReason('ANAS001', 'TOS')).toBeNull()
    expect(noOrderReason(null, 'TOS')).toBeNull()
    expect(noOrderReason('MYHO001', null)).toBeNull()
  })
})
