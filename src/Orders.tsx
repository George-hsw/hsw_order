import { track, trackError } from './lib/analytics/track'
import Modal from './Modal'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { copyText } from './CopyDialog'
import { useConfirm } from './Confirm'
import StatusChip from './StatusChip'
import { useToast } from './Toast'
import { api } from './lib/api'
import { groupByVendor, lineCost, money, navText } from './lib/order'
import { ORDER_STATUS_LABEL, type OrderLine, type OrderStatus, type OrderSummary, type StoreRow } from './lib/supabase'

interface Props { multi: boolean; stores: StoreRow[]; names: Record<string, string>; refreshKey: number }

type StatusFilter = 'all' | OrderStatus
const when = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

/** Every order for the store, newest first. Open one to see its lines or copy it for NAV again. */
export default function Orders({ multi, stores, names, refreshKey }: Props) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    setFailed(false)
    setOrders(null)
    try { setOrders(await api.listOrders(stores.map((s) => s.id))) } catch { setFailed(true) }
  }, [stores])
  useEffect(() => { load() }, [load, refreshKey])

  const who = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '–')
  const remove = async (o: OrderSummary) => {
    if (!(await ask({
      title: `Delete the ${o.vendor_no} order?`,
      body: <p>{o.lines} {o.lines === 1 ? 'line' : 'lines'} for {o.stores?.name ?? 'this store'} will be removed. This cannot be undone.</p>,
      confirmLabel: 'Delete order', danger: true,
    }))) return
    try {
      await api.deleteOrder(o.id)
      toast.success(`${o.vendor_no} order deleted.`)
      track('order_deleted', { vendor: o.vendor_no }, o.store_id)
      load()
    } catch (e) { trackError('orders', e); toast.error('Could not delete the order. Try again.') }
  }
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (orders ?? []).filter((o) =>
      (status === 'all' || o.status === status) &&
      (!term || [o.nav_ref, o.vendor_no, who(o.created_by), o.stores?.name].some((v) => v?.toLowerCase().includes(term))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, status, q, names])
  const open = orders?.find((o) => o.id === openId) ?? null

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Orders</h1>
          <p className="muted">Every order for your {multi ? 'stores' : 'store'}, newest first.</p>
        </div>
      </div>

      <div className="filters">
        <input type="search" name="orderSearch" aria-label="Search orders" placeholder="Search by vendor, NAV number, person or store…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="group" aria-label="Status">
          {(['all', 'open', 'copied', 'ordered'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : s === 'ordered' ? 'Ordered' : ORDER_STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>

      {failed ? (
        <div className="state error" role="alert"><p>Orders did not load</p><p className="muted">Check your connection and try again.</p>
          <div className="actions"><button type="button" className="btn" onClick={load}>Try again</button></div></div>
      ) : !orders ? (
        <div className="skeleton" aria-busy="true" aria-label="Loading orders"><i /><i /><i /><i /></div>
      ) : shown.length === 0 ? (
        <div className="state"><p>{orders.length === 0 ? 'No orders yet' : 'No orders match'}</p>
          <p className="muted">{orders.length === 0 ? 'Orders appear here as soon as you save an item on the Order tab.' : 'Try a different search or status.'}</p></div>
      ) : (
        <div className="tablewrap">
          <table className="book orders">
            <thead><tr><th>Started</th>{multi && <th>Store</th>}<th>Vendor</th><th>By</th><th>Status</th><th className="r">Lines</th><th className="r">Units</th><th className="r">Cost</th><th>NAV order</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td data-label="Started">{when(o.created_at)}</td>
                  {multi && <td data-label="Store">{o.stores?.name ?? ''}</td>}
                  <td data-label="Vendor"><b>{o.vendor_no}</b></td>
                  <td data-label="By">{who(o.created_by)}</td>
                  <td data-label="Status"><StatusChip status={o.status} /></td>
                  <td data-label="Lines" className="r num">{o.lines}</td>
                  <td data-label="Units" className="r num">{o.units}</td>
                  <td data-label="Cost" className="r num">{money(o.cost)}</td>
                  <td data-label="NAV order">{o.nav_ref ? <span className="num">{o.nav_ref}</span> : <span className="muted">–</span>}</td>
                  <td className="rowactions">
                    <button type="button" className="btn" onClick={() => setOpenId(o.id)}>Open</button>
                    {o.status !== 'ordered' && <button type="button" className="btn danger" onClick={() => remove(o)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <OrderDetail order={open} who={who} onClose={() => setOpenId(null)} />}
      {confirmDialog}
    </>
  )
}

/** One order's lines, with a copy button for each vendor. Read only: an open order is changed on the Order tab. */
function OrderDetail({ order, who, onClose }: { order: OrderSummary; who: (e: string | null) => string; onClose: () => void }) {
  const toast = useToast()
  const [lines, setLines] = useState<OrderLine[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    api.orderLines(order.id).then((l) => live && setLines(l)).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [order.id])

  const copy = async (vendor: string) => {
    const g = groupByVendor(lines ?? []).find((x) => x.vendor === vendor)!
    if (await copyText(navText(g))) toast.success(`Copied ${g.lines.length} ${g.lines.length === 1 ? 'line' : 'lines'} for ${vendor}.`)
    else toast.error('Could not copy. Select the lines and copy them by hand.')
  }

  return (
    <Modal labelledBy="order-title" onClose={onClose}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="order-title">{order.stores?.name} · {order.vendor_no} · {when(order.created_at)}</h2>
        <p className="muted"><StatusChip status={order.status} /> Started by {who(order.created_by)}{order.nav_ref ? <> · NAV order <span className="num">{order.nav_ref}</span></> : null}</p>

        {failed ? (
          <div className="state error"><p>The lines did not load</p></div>
        ) : !lines ? (
          <div className="skeleton" aria-busy="true"><i /><i /></div>
        ) : lines.length === 0 ? (
          <div className="state"><p>No lines</p></div>
        ) : (
          groupByVendor(lines).map((g) => (
            <section key={g.vendor}>
              <h3>{g.vendor} <small>{g.totals.lines} {g.totals.lines === 1 ? 'line' : 'lines'}, {g.totals.units} units, {money(g.totals.cost)}</small></h3>
              <div className="tablewrap">
                <table className="book detail">
                  <thead><tr><th>Item</th><th>Description</th><th className="r">Qty</th><th className="r">Cost</th></tr></thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.id}>
                        <td data-label="Item" className="num">{l.item_code}</td>
                        <td data-label="Description">{l.description}</td>
                        <td data-label="Qty" className="r num">{l.qty}</td>
                        <td data-label="Cost" className="r num">{money(lineCost(l.qty, l.unit_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions"><button type="button" className="btn" onClick={() => copy(g.vendor)}>Copy {g.vendor} for NAV</button></div>
            </section>
          ))
        )}
        <div className="actions"><button type="button" className="btn primary" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  )
}
