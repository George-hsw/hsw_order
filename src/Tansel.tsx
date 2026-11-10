import { useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import { track, trackError } from './lib/analytics/track'
import { money, type Product } from './lib/order'
import { BLANK, EXAMPLE, fit, type CabinetInput, type Hinges, type MountPref, type Product as Kind, type RackModel } from './lib/tansel'
import type { StoreRow } from './lib/supabase'
import { useToast } from './Toast'
import { useConfirm } from './Confirm'
import type { Line } from './lib/quote'

const STORE_KEY = 'hsw-orders-store'
const KEEP_KEY = 'hsw-tansel'
const MAX_CABINETS = 6

const PRODUCTS: [Kind, string][] = [['baskets', 'Pull-out baskets'], ['laundry', 'Laundry hamper'], ['undersink', 'Under-sink double rack'], ['frame', 'Multi-frame (side frame + hanging baskets)']]
const HINGES: [Hinges, string][] = [['left', 'Hinges on LEFT'], ['right', 'Hinges on RIGHT'], ['both', 'Hinges on BOTH sides'], ['none', 'No hinges']]
const RACKS: [RackModel, string][] = [['auto', 'Auto (largest that fits)'], ['TAN040', 'TAN040 Spice rack 100/100'], ['TAN050', 'TAN050 Detergent 100/150'], ['TAN051', 'TAN051 Detergent 100/200'], ['TAN052', 'TAN052 Detergent 150/200']]

const loadKept = (): CabinetInput[] => {
  try { const v = JSON.parse(sessionStorage.getItem(KEEP_KEY) ?? 'null'); if (Array.isArray(v) && v.length) return v.map((c) => ({ ...BLANK, ...c })) } catch { /* ignore */ }
  return [{ ...BLANK }]
}
const plain = (s: string) => s.replace(/^[✓✗]\s*/, '') // the screen says Fits or Does not fit in words, so the tick and cross are dropped

/** One number box: blank means "not entered", and only digits are kept. */
function Num({ label, hint, value, onChange, name }: { label: string; hint?: string; value: number; onChange: (n: number) => void; name: string }) {
  return (
    <label>{label}
      <input name={name} inputMode="numeric" autoComplete="off" value={value > 0 ? String(value) : ''} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

/**
 * Works out which Tansel basket, slides and battens fit a customer's cabinet. This is the store's Tansel Pull-Out Finder
 * spreadsheet, moved into the app, so there is nothing to save or keep up to date on a computer. Each code on the list is
 * looked up in the item list for its price and stock.
 */
export default function Tansel({ stores, multi, draftKey, onQuote }: { stores: StoreRow[]; multi: boolean; draftKey: string; onQuote: (lines: Line[]) => void }) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [cabs, setCabs] = useState<CabinetInput[]>(loadKept)
  const [at, setAt] = useState(0)
  const [storeId, setStoreId] = useState(() => { try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ } return stores[0]?.id ?? '' })
  const [items, setItems] = useState<Map<string, Product | null>>(new Map())

  const c = cabs[at] ?? cabs[0]
  const set = (patch: Partial<CabinetInput>) => setCabs((all) => all.map((x, i) => (i === at ? { ...x, ...patch } : x)))
  useEffect(() => { try { sessionStorage.setItem(KEEP_KEY, JSON.stringify(cabs)) } catch { /* ignore */ } }, [cabs])

  const r = useMemo(() => fit(c), [c])
  const codeKey = r.codes.map((x) => x.code).join('|')

  // Price and stock for each code, from the item list (NAV). A code the item list does not have is shown as such.
  useEffect(() => {
    if (!storeId || !r.codes.length) return
    let live = true
    setItems(new Map())
    ;(async () => {
      const got = new Map<string, Product | null>()
      for (const line of r.codes) {
        try { const hits = await api.findItems(storeId, line.code); got.set(line.code, hits.find((h) => h.item.code.toLowerCase() === line.code.toLowerCase()) ?? null) } catch (e) { trackError('tansel lookup', e); got.set(line.code, null) }
      }
      if (live) setItems(got)
    })()
    return () => { live = false }
  }, [codeKey, storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (r.fits) track('tansel_fit', { product: c.product }, storeId) }, [r.fits, c.product, storeId])

  const changeStore = (id: string) => { setStoreId(id); try { localStorage.setItem(STORE_KEY, id) } catch { /* ignore */ } }
  const copyCodes = async () => {
    const text = r.codes.map((x) => `${x.code}\t${x.qty}`).join('\n')
    try { await navigator.clipboard.writeText(text); toast.success('The code list is copied.') } catch { toast.error('Could not copy. Select the codes and copy them by hand.') }
  }

  // A new quote with these codes and quantities. If there is an unfinished quote on this device, ask before replacing it.
  const startQuote = async () => {
    let busy = false
    try { const d = JSON.parse(localStorage.getItem(draftKey) ?? 'null'); busy = !!(d?.customer?.name || d?.lines?.some((l: Line) => l.code)) } catch { /* no draft */ }
    if (busy && !(await ask({ title: 'Replace your unfinished quote?', body: <p>There is a quote in progress on this device. Starting this one clears it.</p>, confirmLabel: 'Start a new quote' }))) return
    track('tansel_quote', { lines: r.codes.length }, storeId)
    onQuote(r.codes.map((x) => ({ code: x.code, qty: String(x.qty), ownDescription: '', ownPrice: '', discPct: '' })))
  }

  const fam = c.product
  const hasMoney = (p: Product | null | undefined) => p?.item.price != null
  const lineTotal = r.codes.reduce((a, x) => { const p = items.get(x.code); return hasMoney(p) ? a + (p!.item.price as number) * x.qty : a }, 0)
  const allPriced = r.codes.length > 0 && r.codes.every((x) => hasMoney(items.get(x.code)))

  return (
    <div className="tansel">
      <div className="pagehead">
        <div>
          <h1>Tansel pull-outs</h1>
          <p className="muted">Work out which Tansel basket, slides and battens fit a cabinet. Measure the inside of the cabinet at its narrowest point, in millimetres.</p>
        </div>
        <div className="actions">
          {multi && (
            <label className="inline">Store
              <select name="store" value={storeId} onChange={(e) => changeStore(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
          )}
          <button type="button" className="btn" onClick={() => set({ ...EXAMPLE })}>Fill in the example</button>
          <button type="button" className="btn" onClick={() => set({ ...BLANK })}>Clear</button>
        </div>
      </div>

      <div className="filters">
        <div className="segmented" role="group" aria-label="Cabinet">
          {cabs.map((_, i) => <button key={i} type="button" aria-pressed={i === at} onClick={() => setAt(i)}>Cabinet {i + 1}</button>)}
        </div>
        {cabs.length < MAX_CABINETS && <button type="button" className="btn" onClick={() => { setCabs((a) => [...a, { ...BLANK }]); setAt(cabs.length) }}>Add a cabinet</button>}
        {cabs.length > 1 && <button type="button" className="btn" onClick={() => { setCabs((a) => a.filter((_, i) => i !== at)); setAt(Math.max(0, at - 1)) }}>Remove this cabinet</button>}
      </div>

      <section className="sheet viz-card tansel-form">
        <h2 className="pricesub">1. What are we fitting?</h2>
        <div className="grid">
          <label>Product
            <select name="product" value={c.product} onChange={(e) => set({ product: e.target.value as Kind })}>{PRODUCTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            <small className="muted">Most customers want pull-out baskets.</small>
          </label>
          {fam !== 'frame' && (
            <label>Mount
              <select name="mount" value={c.mount} onChange={(e) => set({ mount: e.target.value as MountPref })}>
                <option value="auto">Recommended</option><option value="bottom">Bottom mount</option><option value="side">Side mount</option>
              </select>
              <small className="muted">Leave on Recommended unless the customer asks for one.</small>
            </label>
          )}
          {fam === 'baskets' && (
            <label>Bottom mount: baskets side by side
              <select name="across" value={c.across} onChange={(e) => set({ across: Number(e.target.value) as 1 | 2 | 3 })}>
                <option value={1}>1 basket across the space</option><option value={2}>2 baskets side by side</option><option value={3}>3 baskets side by side</option>
              </select>
              <small className="muted">Only for 2 or 3 smaller baskets instead of one wide one. Side mounts must go wall to wall, so they cannot be split.</small>
            </label>
          )}
          {fam === 'baskets' && (
            <label>Basket depth
              <select name="basketDepth" value={String(c.depthChoice)} onChange={(e) => set({ depthChoice: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 485 | 400 | 600) })}>
                <option value="auto">Auto</option><option value="485">485 (standard, in stock)</option><option value="400">400 (special order)</option><option value="600">600 (special order)</option>
              </select>
              <small className="muted">Leave on Auto. Choose 485 if the customer only wants stock items.</small>
            </label>
          )}
        </div>

        <h2 className="pricesub">2. Cabinet measurements (mm)</h2>
        <div className="grid">
          <Num name="width" label="Internal cabinet width" value={c.width} onChange={(n) => set({ width: n })} hint="Inside, wall to wall, at the narrowest spot. For example 568, not 56.8." />
          <Num name="depth" label="Internal cabinet depth" value={c.depth} onChange={(n) => set({ depth: n })} hint="Front edge of the cabinet to the back wall, not the shelf." />
          <label>Shelves
            <select name="shelves" value={c.fixedShelves ? 'fixed' : 'adjustable'} onChange={(e) => set({ fixedShelves: e.target.value === 'fixed' })}>
              <option value="adjustable">Adjustable / removable</option><option value="fixed">Fixed</option>
            </select>
            <small className="muted">Can the shelves be lifted out? Choose Adjustable. Screwed or glued in? Choose Fixed.</small>
          </label>
          {c.fixedShelves
            ? <Num name="heightFixed" label="Height between fixed shelves" value={c.heightFixed} onChange={(n) => set({ heightFixed: n })} hint="From the shelf up to the shelf above it." />
            : <Num name="heightFree" label="Height with all shelves removed" value={c.heightFree} onChange={(n) => set({ heightFree: n })} hint="Cabinet floor to the top, shelves taken out." />}
        </div>

        <h2 className="pricesub">3. Hinges</h2>
        <div className="grid">
          <label>Hinges
            <select name="hinges" value={c.hinges} onChange={(e) => set({ hinges: e.target.value as Hinges })}>{HINGES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            <small className="muted">Stand in front with the door open. Two doors means both sides. No door means no hinges.</small>
          </label>
          {c.hinges !== 'none' && <Num name="hingeWidth" label="Hinge block width" value={c.hingeWidth} onChange={(n) => set({ hingeWidth: n })} hint="Wall to the inside edge of the hinge, door open. Usually 20 to 25. Not sure? Leave it blank." />}
        </div>

        <h2 className="pricesub">4. What does the customer want?</h2>
        <div className="grid">
          {fam === 'baskets' && <Num name="count" label="How many baskets?" value={c.count} onChange={(n) => set({ count: n })} hint="Leave blank and it works out one basket for every 25 cm of height." />}
          {fam === 'baskets' && <Num name="tall" label="Of those, how many 150 mm high?" value={c.tall} onChange={(n) => set({ tall: n })} hint="The tall ones suit bottles. The rest are 100 mm high." />}
          {fam === 'laundry' && (
            <label>Add a calico bag?
              <select name="calico" value={c.calico ? 'yes' : 'no'} onChange={(e) => set({ calico: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes</option></select>
            </label>
          )}
          {fam === 'undersink' && (
            <label>Under-sink rack model
              <select name="rack" value={c.rack} onChange={(e) => set({ rack: e.target.value as RackModel })}>{RACKS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              <small className="muted">Leave on Auto unless the pipes get in the way of the one it picks.</small>
            </label>
          )}
          {(fam === 'laundry' || fam === 'undersink') && <Num name="units" label="How many units?" value={c.units} onChange={(n) => set({ units: n || 1 })} hint="Usually 1." />}
          {fam === 'frame' && <Num name="mf100" label="How many 100W baskets?" value={c.mf100} onChange={(n) => set({ mf100: n })} />}
          {fam === 'frame' && <Num name="mf200" label="How many 200W baskets?" value={c.mf200} onChange={(n) => set({ mf200: n })} />}
          {fam === 'frame' && <Num name="mf300" label="How many 300W baskets?" value={c.mf300} onChange={(n) => set({ mf300: n })} />}
        </div>
      </section>

      <section className="sheet viz-card tansel-result" aria-live="polite">
        <div className="viz-head"><h2>Result</h2></div>
        <p className={r.fits ? 'note' : 'note bad'} role={r.fits ? 'status' : 'alert'}>{/^IT FITS/i.test(plain(r.headline)) ? <><b>It fits.</b> See the set-up below.</> : plain(r.headline)}</p>
        {r.fits && (
          <dl className="tlist">
            <div><dt>What to pick</dt><dd>{r.pick}</dd></div>
            <div><dt>Slides and mounting</dt><dd>{r.slides}</dd></div>
            <div><dt>Packers, left side (each drawer)</dt><dd>{r.packersLeft}</dd></div>
            <div><dt>Packers, right side (each drawer)</dt><dd>{r.packersRight}</dd></div>
            {r.weight && <div><dt>Weight limit</dt><dd>{r.weight}</dd></div>}
          </dl>
        )}
        {(r.height || r.depthCheck) && (
          <dl className="tlist">
            {r.height && <div><dt>Height and number of baskets</dt><dd>{plain(r.height)}</dd></div>}
            {r.depthCheck && <div><dt>Depth check</dt><dd>{plain(r.depthCheck)}</dd></div>}
          </dl>
        )}
        {r.notes && <p className="muted tnotes"><b>Notes for staff.</b> {r.notes}</p>}
      </section>

      {r.compare.length > 0 && (
        <section className="sheet viz-card">
          <div className="viz-head"><h2>All mounting options compared</h2></div>
          <ul className="tcompare">
            {r.compare.map((m) => (
              <li key={m.label} className={m.star ? 'tstar' : undefined}>
                <b>{m.label}{m.star && <span className="chip quote">Recommended</span>}</b>
                <dl className="tlist">
                  <div><dt>Biggest single basket</dt><dd>{m.biggest}</dd></div>
                  {m.left && <div><dt>Packers left</dt><dd>{m.left}</dd></div>}
                  {m.right && <div><dt>Packers right</dt><dd>{m.right}</dd></div>}
                  {m.spacer && <div><dt>Spacer or gap</dt><dd>{m.spacer}</dd></div>}
                  {m.weight && <div><dt>Weight limit</dt><dd>{m.weight}</dd></div>}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.codes.length > 0 && (
        <section className="sheet viz-card">
          <div className="viz-head">
            <div><h2>Codes to enter into the POS</h2><p className="muted">One line per item. Packers above are per drawer; the quantities here already multiply them. Battens are cut to size and spacer discs come in packs of 12.</p></div>
            <div className="actions">
              <button type="button" className="btn" onClick={() => void copyCodes()}>Copy the codes</button>
              <button type="button" className="btn primary" onClick={() => void startQuote()}>Start a quote with these items</button>
            </div>
          </div>
          <ul className="tcodes">
            {r.codes.map((x) => {
              const p = items.get(x.code)
              const st = p?.stock
              return (
                <li key={x.code}>
                  <span className="tqty num">{x.qty} ×</span>
                  <span><b>{x.code}</b><small className="muted">{x.description}</small></span>
                  <span className="tprice num">
                    {p === undefined ? <small className="muted">Looking…</small> : p === null ? <small className="muted">Not in the item list</small>
                      : <>{p.item.price != null ? <b>{money(p.item.price)}</b> : <small className="muted">No price</small>}<small className="muted">{st ? `${st.inventory} in stock here` : 'No stock record'}</small></>}
                  </span>
                </li>
              )
            })}
          </ul>
          {allPriced && <p className="tsum"><span>Total at the item list prices</span><b className="num">{money(lineTotal)}</b></p>}
          <p className="muted viz-foot">Prices come from the item list, the same as Price check. The POS price decides, in case of a promotion.</p>
        </section>
      )}

      <details className="sheet viz-card tgood">
        <summary>Good to know</summary>
        <ul>
          <li>Measure the inside of the cabinet at its narrowest point. The result is only as good as the measurements, so if in doubt, measure again.</li>
          <li>Leave Mount on Recommended and Depth on Auto unless the customer asks for something different.</li>
          <li>400 and 600 deep baskets are special order. Confirm with Tansel before promising the customer. For stock items only, choose 485.</li>
          <li>600 deep baskets only go up to 550 wide. In a deep, wide cabinet it picks 485 deep. If the customer wants 600 deep, choose 2 baskets side by side.</li>
          <li>Battens lower the weight limit: drawers are rated 40 kg, but 30 kg when battens are used. Tell the customer.</li>
          <li>Hinges: the spacer slides clear hinges up to about 25 mm. Bigger hinges are packed out with battens. Leave the hinge box blank and it assumes 25 mm.</li>
          <li>Under-sink racks: the finder cannot see the pipes. Check the plumbing and the sink bowl before ordering.</li>
          <li>The number of baskets is a guide, one for every 25 cm of height. For tall bottles or small spice jars, type the number the customer wants.</li>
          <li>Odd cabinets (corner cabinets, angled walls, very narrow or very deep spaces, or anything that does not fit): call Tansel on 02 9440 9800 or email sales2@tansel.com.au with the measurements and photos. They can do custom sizes.</li>
        </ul>
      </details>
      {confirmDialog}
    </div>
  )
}
