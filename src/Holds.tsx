import { useMemo, useState } from 'react'
import ItemPicker from './ItemPicker'
import Loading from './Loading'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { closuresApi } from './lib/closures/api'
import { demoItems } from './lib/demo'
import { loadPriceList } from './lib/items'
import { DEMO } from './lib/supabase'
import { useLoad } from './lib/useLoad'

const describe = async (): Promise<Map<string, string>> => {
  const items = DEMO ? demoItems().map((i) => ({ code: i.code, description: i.description })) : (await loadPriceList()).items
  return new Map(items.map((i) => [i.code, i.description]))
}

/**
 * Operations: items a store must always have in stock. Each hold is an item, a store and a minimum. A store below its minimum gets the item in its
 * suggested order, and sees it on the Hold tab of the vendor. Setting an item again changes its minimum.
 */
export default function Holds() {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const stores = useLoad(() => closuresApi.opsStores(), [])
  const holds = useLoad(() => closuresApi.holds(), [])
  const names = useLoad(describe, [])
  const [chosen, setChosen] = useState<Set<string> | null>(null) // null: every store
  const [filter, setFilter] = useState('')

  const active = useMemo(() => (stores.data ?? []).filter((s) => s.active), [stores.data])
  const storeName = (id: string) => stores.data?.find((s) => s.id === id)?.name ?? 'A store'
  const picked = chosen ?? new Set(active.map((s) => s.id))
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setChosen(n) }

  if (stores.loading || holds.loading) return <Loading />
  if (stores.failed || holds.failed || !stores.data || !holds.data) {
    return <div className="state error" role="alert"><p>The holds did not load</p><div className="actions"><button type="button" className="btn" onClick={() => { stores.retry(); holds.retry() }}>Try again</button></div></div>
  }

  const add = async (item: { code: string; description: string }, qty: number) => {
    if (picked.size === 0) { toast.error('Choose at least one store.'); return false }
    try {
      await closuresApi.setHold([...picked], item.code, qty)
      toast.success(`${item.code} is now always in stock: at least ${qty} at ${picked.size === active.length ? 'every store' : `${picked.size} ${picked.size === 1 ? 'store' : 'stores'}`}.`)
      holds.retry()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save the hold. Try again.'); return false }
  }
  const remove = async (store_id: string, code: string) => {
    if (!(await ask({ title: `Stop holding ${code} at ${storeName(store_id)}?`, body: 'The store will no longer be asked to keep a minimum of this item.', confirmLabel: 'Stop holding', danger: true }))) return
    try { await closuresApi.removeHold(store_id, code); toast.success(`${code} is no longer held at ${storeName(store_id)}.`); holds.retry() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove the hold. Try again.') }
  }

  const rows = holds.data.filter((h) => !filter || h.store_id === filter)
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Always in stock</h1>
          <p className="muted">Choose items a store must always have, and the least it should hold. When a store falls below it, the item is added to that store’s suggested order, and it shows on the Hold tab of the vendor.</p>
        </div>
      </div>

      <section className="sheet">
        <div className="block">
          <h2>Add or change a hold</h2>
          <fieldset className="plain">
            <legend>Stores</legend>
            <div className="actions quick">
              <button type="button" className="btn" onClick={() => setChosen(null)}>All stores</button>
              <button type="button" className="btn" onClick={() => setChosen(new Set())}>None</button>
            </div>
            <div className="grid">
              {active.map((s) => (
                <label key={s.id} className="tick"><input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />{s.name}</label>
              ))}
            </div>
          </fieldset>
          <p className="muted">Find the item and enter the minimum quantity. Adding an item that is already held changes its minimum.</p>
          <ItemPicker onAdd={add} />
        </div>
        <div className="block">
          <h2>Held items <small>{rows.length} {rows.length === 1 ? 'hold' : 'holds'}</small></h2>
          <label className="inline">Store
            <select name="holdstore" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All stores</option>
              {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {rows.length === 0 ? (
            <div className="state"><p>Nothing is held yet</p><p className="muted">Add an item above to make sure stores always have it.</p></div>
          ) : (
            <div className="tablewrap">
              <table className="book holds">
                <thead><tr><th>Item</th><th>Description</th><th>Store</th><th className="r">Minimum</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.store_id + h.item_code}>
                      <td data-label="Item" className="num">{h.item_code}</td>
                      <td data-label="Description" className="desc">{names.data?.get(h.item_code) ?? ''}</td>
                      <td data-label="Store">{storeName(h.store_id)}</td>
                      <td data-label="Minimum" className="r">{h.min_qty}</td>
                      <td className="rowactions"><button type="button" className="btn" aria-label={`Stop holding ${h.item_code} at ${storeName(h.store_id)}`} onClick={() => void remove(h.store_id, h.item_code)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      {confirmDialog}
    </>
  )
}
