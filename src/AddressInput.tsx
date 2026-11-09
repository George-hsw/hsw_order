import { useEffect, useId, useRef, useState } from 'react'
import { searchAddress, type Suggestion } from './lib/address'

interface Props {
  name: string
  value: string
  onChange: (v: string) => void
  onPick: (s: Suggestion) => void
}

/** A text box that suggests Australian addresses as you type. Typing by hand always still works. */
export function AddressInput({ name, value, onChange, onPick }: Props) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef(false) // only search for what a person typed, not for a value that was filled in
  const listId = useId()

  useEffect(() => {
    if (!typed.current) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      searchAddress(value, ctl.signal).then((r) => { setItems(r); setActive(-1); setOpen(r.length > 0) }).catch(() => { /* offline or aborted: no suggestions */ })
    }, 300)
    return () => { clearTimeout(t); ctl.abort() }
  }, [value])

  const pick = (s: Suggestion) => { typed.current = false; setOpen(false); setItems([]); onPick(s) }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)) }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <>
      <input name={name} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        value={value} onKeyDown={onKey} onBlur={() => setOpen(false)}
        onChange={(e) => { typed.current = true; onChange(e.target.value) }} />
      {open && (
        <ul className="results addr" id={listId} role="listbox">
          {items.map((s, i) => (
            <li key={s.label} role="option" aria-selected={i === active} className={i === active ? 'on' : undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(s) }}>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
