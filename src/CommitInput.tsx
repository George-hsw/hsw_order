import { useState } from 'react'

/**
 * A small box in a shared list. It keeps what is being typed to itself and hands it over on leaving the box or pressing Enter,
 * so a live update from another device never overwrites it half way.
 */
export default function CommitInput({ name, label, value, inputMode, onCommit }: { name: string; label: string; value: string; inputMode: 'numeric' | 'decimal'; onCommit: (v: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const done = () => { if (typed !== null && typed !== value) onCommit(typed); setTyped(null) }
  return (
    <input className="qty" name={name} inputMode={inputMode} autoComplete="off" enterKeyHint="done" aria-label={label} value={typed ?? value}
      onChange={(e) => setTyped(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
