// Store passwords: generated here so they are long and random, checked here when an admin chooses one.
// Supabase Auth hashes (bcrypt) and keeps them; this app and the repo never store a password or its hash.

// No 0 O 1 l I, so a password read aloud or typed from a note is hard to get wrong.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const LIMIT = Math.floor(0x1_0000_0000 / ALPHABET.length) * ALPHABET.length // rejection sampling: no modulo bias

export const MIN_LENGTH = 10
export const MAX_LENGTH = 72 // bcrypt ignores anything past 72 bytes

/** e.g. "Kp7Wx-9mTqE-hY4Rb-Nc3Zs": 16 random characters in 4 groups (about 90 bits). */
export function generatePassword(groups = 4, size = 4): string {
  const need = groups * size
  const chars: string[] = []
  while (chars.length < need) {
    const buf = new Uint32Array(32)
    crypto.getRandomValues(buf)
    for (const v of buf) if (v < LIMIT && chars.length < need) chars.push(ALPHABET[v % ALPHABET.length])
  }
  return Array.from({ length: groups }, (_, g) => chars.slice(g * size, (g + 1) * size).join('')).join('-')
}

/** null when the password is acceptable, otherwise what to tell the admin. */
export function checkPassword(p: string): string | null {
  if (p.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters`
  if (p.length > MAX_LENGTH) return `Use ${MAX_LENGTH} characters or fewer`
  if (p !== p.trim()) return 'Remove the spaces at the start or end'
  return null
}
