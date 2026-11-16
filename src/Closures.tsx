import { useState } from 'react'
import ClosureDashboard from './ClosureDashboard'
import ClosureSent from './ClosureSent'
import ClosureUpload from './ClosureUpload'
import Loading from './Loading'
import { closuresApi } from './lib/closures/api'
import { closureProgress } from './lib/closures/status'
import { useLoad } from './lib/useLoad'

type Screen = { kind: 'list' } | { kind: 'upload' } | { kind: 'open'; id: string }
const when = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })

/** Store closures, for operations: the list, starting a new one, and one closure's plan or status. */
export default function Closures({ names }: { names: Record<string, string> }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const stores = useLoad(() => closuresApi.opsStores(), [])
  const list = useLoad(() => Promise.all([closuresApi.list(), closuresApi.requestStatuses()]), [screen.kind])
  const back = () => { setScreen({ kind: 'list' }); list.retry() }

  if (stores.loading) return <Loading />
  if (stores.failed || !stores.data) return <div className="state error" role="alert"><p>The stores did not load</p><div className="actions"><button type="button" className="btn" onClick={stores.retry}>Try again</button></div></div>
  const storeList = stores.data
  const storeName = (id: string) => storeList.find((s) => s.id === id)?.name ?? 'A store'

  if (screen.kind === 'upload') return <ClosureUpload stores={storeList} onCancel={back} onDone={(id) => setScreen({ kind: 'open', id })} />
  if (screen.kind === 'open') {
    return <ClosureDashboard id={screen.id} stores={storeList} names={names} onBack={back}
      renderSent={(d, reload) => <ClosureSent d={d} stores={storeList} names={names} onBack={back} reload={reload} />} />
  }

  const [closures, statuses] = list.data ?? [[], []]
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Closures</h1>
          <p className="muted">When a store closes, upload its stock, choose which stores take it, and send each store a request to accept. Stores see theirs under Transfers.</p>
        </div>
        <div className="actions"><button type="button" className="btn primary" onClick={() => setScreen({ kind: 'upload' })}>New closure</button></div>
      </div>

      {list.loading ? <Loading /> : list.failed ? (
        <div className="state error" role="alert"><p>The closures did not load</p><div className="actions"><button type="button" className="btn" onClick={list.retry}>Try again</button></div></div>
      ) : closures.length === 0 ? (
        <div className="state"><p>No closures yet</p><p className="muted">Start one when a store is closing: you upload its stock sheet, then choose who takes what.</p><div className="actions"><button type="button" className="btn" onClick={() => setScreen({ kind: 'upload' })}>Start a closure</button></div></div>
      ) : (
        <div className="tablewrap">
          <table className="book closures">
            <thead><tr><th>Closure</th><th>Status</th><th>Started</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{closures.map((c) => {
              const p = closureProgress(statuses.filter((s) => s.closure_id === c.id))
              return (
                <tr key={c.id}>
                  <td data-label="Closure"><b>{c.name || `${storeName(c.closing_store_id)} closure`}</b><small className="sub">{storeName(c.closing_store_id)}</small></td>
                  <td data-label="Status">
                    {c.status === 'draft' ? <span className="chip warn">Draft</span>
                      : c.status === 'cancelled' ? <span className="chip">Cancelled</span>
                      : <><span className="chip paid">Sent</span><small className="sub">{p.total - p.waiting - p.cancelled} of {p.total - p.cancelled} answered{p.received ? `, ${p.received} received` : ''}</small></>}
                  </td>
                  <td data-label="Started">{when(c.created_at)}<small className="sub">{names[c.created_by.toLowerCase()] ?? c.created_by}</small></td>
                  <td className="rowactions"><button type="button" className="btn" aria-label={`Open ${c.name || storeName(c.closing_store_id)}`} onClick={() => setScreen({ kind: 'open', id: c.id })}>Open</button></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </>
  )
}
