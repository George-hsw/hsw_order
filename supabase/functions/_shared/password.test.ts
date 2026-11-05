import { describe, expect, it } from 'vitest'
import { checkPassword, generatePassword, MAX_LENGTH, MIN_LENGTH } from './password'

describe('generatePassword', () => {
  it('makes 4 groups of 4, from an alphabet without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword()
      expect(p).toMatch(/^[A-HJKMNP-Za-hjkmnp-z2-9]{4}(-[A-HJKMNP-Za-hjkmnp-z2-9]{4}){3}$/)
      expect(p).not.toMatch(/[01OlI]/)
    }
  })
  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword()))
    expect(seen.size).toBe(500)
  })
  it('passes its own check', () => {
    expect(checkPassword(generatePassword())).toBeNull()
  })
})

describe('checkPassword', () => {
  it('enforces length and stray spaces', () => {
    expect(checkPassword('short')).toContain(`${MIN_LENGTH}`)
    expect(checkPassword('x'.repeat(MAX_LENGTH + 1))).toContain(`${MAX_LENGTH}`)
    expect(checkPassword(' leadingspace1')).toContain('spaces')
    expect(checkPassword('a perfectly fine passphrase')).toBeNull()
  })
})
