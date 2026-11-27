import { useEffect, useMemo, useRef, useState } from 'react'
import Scanner from './Scanner'
import { useToast } from './Toast'
import { beep, primeAudio } from './lib/beep'
import { demoItems } from './lib/demo'
import { findByScan, indexBarcodes, indexItems, loadPriceList, searchItems } from './lib/items'
import type { Item } from './lib/quote'
import { DEMO } from './lib/supabase'

let catalogue: Promise<Item[]> | null = null // loaded once, then kept for the next time the picker opens
const loadCatalogue = (): Promise<Item[]> => {
  catalogue ??= (DEMO ? Promise.resolve(demoItems().map((i) => ({ code: i.code, description: i.description, price: i.price, status: 'ACTIVE', barcode: i.barcode || undefined }))) : loadPriceList().then((p) => p.items))
    .catch((e) => { catalogue = null; throw e })
  return catalogue
}

interface Props {
  /** Called with the chosen item and a whole quantity of 1 or more. Return false to keep the item and quantity on screen (for example when it could not be saved). */
  onAdd: (item: { code: string; description: string }, qty: number) => void | boolean | Promise<void | boolean>
  disabled?: boolean
  /** Shows a Scan button. Each barcode read adds one of that item, and the camera stays open for the next. */
  scan?: boolean
}

/** Find an item by code, barcode or name, choose it, give a quantity, add it. The same way an item is found when ordering. */
export default function ItemPicker({ onAdd, disabled, scan }: Props) {
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [find, setFind] = useState('')
  const [picked, setPicked] = useState<Item | null>(null)
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const qtyBox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    loadCatalogue().then((l) => { if (live) setItems(l) }).catch((e) => toast.error(`Could not load the item list. ${e instanceof Error ? e.message : ''}`.trim()))
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const byCode = useMemo(() => indexItems(items), [items])
  const byBarcode = useMemo(() => indexBarcodes(items), [items])
  const matches = useMemo(() => (picked ? [] : searchItems(items, find)), [items, find, picked])

  const choose = (it: Item) => { setPicked(it); setFind(''); setQty(''); setTimeout(() => qtyBox.current?.focus(), 0) }
  const onFindEnter = () => {
    const exact = findByScan(find, byCode, byBarcode) ?? (matches.length === 1 ? matches[0] : undefined)
    if (exact) choose(exact)
  }
  const add = async () => {
    const n = Math.floor(Number(qty.replace(/[^\d]/g, '')))
    if (!picked || !(n >= 1)) return toast.error('Enter a quantity of 1 or more.')
    setBusy(true)
    try {
      if ((await onAdd({ code: picked.code, description: picked.description }, n)) === false) return
      setPicked(null); setQty('')
      setTimeout(() => search.current?.focus(), 0)
    } finally { setBusy(false) }
  }

  const openScanner = () => { primeAudio(); setScanMsg(''); (document.activeElement as HTMLElement | null)?.blur?.(); setScanning(true) }
  const onScan = async (value: string) => {
    const it = findByScan(value, byCode, byBarcode)
    if (!it) { beep('miss'); setScanMsg(items.length ? `${value} is not in the price list` : 'The item list is still loading. Scan again in a moment.'); return }
    if ((await onAdd({ code: it.code, description: it.description }, 1)) === false) { beep('miss'); setScanMsg(`${it.description} was not added. Scan it again.`); return }
    beep('ok')
    setScanMsg(`Added 1: ${it.description}`)
  }

  return (
    <div className="finder">
      {picked ? (
        <form className="addline" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <p className="pickedname"><b className="num">{picked.code}</b> {picked.description}</p>
          <input ref={qtyBox} name="pickQty" className="qty" inputMode="numeric" autoComplete="off" aria-label={`Quantity of ${picked.code}`} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button type="submit" className="btn primary" disabled={disabled || busy}>Add</button>
          <button type="button" className="btn" onClick={() => { setPicked(null); setQty('') }} disabled={busy}>Cancel</button>
        </form>
      ) : (
        <>
          <div className="findrow">
            <input ref={search} type="search" name="findItem" aria-label="Find an item" placeholder="Type a code, barcode or name…" autoComplete="off" enterKeyHint="search" value={find} disabled={disabled}
              onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onFindEnter())} />
            {scan && (
              <button type="button" className="btn scanbtn" disabled={disabled} onPointerDown={openScanner} onClick={openScanner}>
                <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
                Scan
              </button>
            )}
          </div>
          {matches.length > 0 && (
            <ul className="results">
              {matches.map((m) => (
                <li key={m.code} onClick={() => choose(m)}>
                  <b>{m.code}</b> {m.description}
                  {m.status && m.status !== 'ACTIVE' && <span>{m.status}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {scanning && <Scanner onScan={(v) => void onScan(v)} onClose={() => setScanning(false)} feedback={scanMsg} />}
    </div>
  )
}
