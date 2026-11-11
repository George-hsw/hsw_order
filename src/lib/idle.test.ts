import { describe, expect, it } from 'vitest'
import { IDLE_LIMIT_MS, IDLE_WARN_MS, idleStatus } from './idle'

describe('idle sign-out', () => {
  const t0 = 1_000_000
  it('is active while the device is in use', () => {
    expect(idleStatus(t0, t0)).toBe('active')
    expect(idleStatus(t0, t0 + IDLE_LIMIT_MS - IDLE_WARN_MS - 1)).toBe('active')
  })
  it('warns in the last minutes, then signs out at the limit', () => {
    expect(idleStatus(t0, t0 + IDLE_LIMIT_MS - IDLE_WARN_MS)).toBe('warn')
    expect(idleStatus(t0, t0 + IDLE_LIMIT_MS - 1)).toBe('warn')
    expect(idleStatus(t0, t0 + IDLE_LIMIT_MS)).toBe('expired')
  })
  it('is two hours with a five minute warning', () => {
    expect(IDLE_LIMIT_MS).toBe(7_200_000)
    expect(IDLE_WARN_MS).toBe(300_000)
  })
})
