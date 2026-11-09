import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { areaOf, type Tab } from './lib/sections'

interface Props {
  isAdmin: boolean
  manager: boolean // a manager somewhere, or the admin: they also take payments and see reports
  onClose: () => void
}

type Scene = 'welcome' | 'build' | 'scan' | 'phone' | 'send' | 'docs' | 'sales' | 'pay' | 'stores' | 'done'
interface Step { title: string; body: string; scene: Scene; tab?: Tab }

/** What each person is shown, in order. The steps they cannot use are left out. */
function stepsFor({ isAdmin, manager }: Pick<Props, 'isAdmin' | 'manager'>): Step[] {
  const steps: Step[] = [
    { scene: 'welcome', title: 'Welcome to HSW', body: 'Home lists what you can open: quotes, stock orders and sales. Press Home or the logo any time to come back. Use Next to move on, or Skip any time.' },
    { scene: 'build', tab: 'new', title: 'Quotes and invoices', body: 'Under Quote, choose New, then the store and the customer, then add items by scanning or searching. The total, GST and due date are worked out for you.' },
    { scene: 'send', title: 'Send it to the customer', body: 'Download the PDF, or choose Open in email. A quote can be turned into an invoice, and Documents lists everything made so far.' },
    { scene: 'scan', tab: 'order', title: 'Choose a vendor', body: 'A purchase order is made for one vendor. Pick the vendor and the whole range your store orders from them is listed, with stock, what is on order and the MOQ.' },
    { scene: 'build', title: 'Type a quantity, or scan', body: 'Type how many to order beside each item, or tap Scan to jump to one. It saves as you go, and a repeat scan never doubles a line.' },
    { scene: 'phone', title: 'Hold it and start the next', body: 'Save and start another order leaves this vendor on hold. Pick it again later under Orders in progress. The phone and the computer show the same order.' },
    { scene: 'send', title: 'Copy into NAV', body: 'When the order looks right, choose Copy for NAV and paste it into the NAV purchase order for that vendor. Then record the NAV order number.' },
    { scene: 'docs', tab: 'orders', title: 'Find past orders in Orders', body: 'Each order shows its status and NAV number. Open one to see its lines, or copy it for NAV again.' },
  ]
  steps.push({ scene: 'docs', title: 'The bell', body: 'The bell at the top lists what needs attention: customers waiting on an order, items running low, overdue invoices. Press Open to go straight to it, or Hide to put it away for a day.' })
  steps.push({ scene: 'docs', tab: 'new', title: 'Customer orders', body: 'For something a customer wants that is not in stock, make a Customer Order under Quote and take a deposit. The Order tab and Home remind you until it is marked ordered.' })
  steps.push({ scene: 'scan', tab: 'price', title: 'Check a price', body: 'Price check: scan a barcode, or type an item number or part of the name, to see the price, the stock here and recent sales. Print a price label to any printer on the same Wi-Fi.' })
  if (manager) steps.push({ scene: 'pay', tab: 'new', title: 'Payments and reports', body: 'Record a deposit or payment on an invoice and the store managers are told. Under Quote, Reports shows each person’s quotes and invoices.' })
  steps.push({ scene: 'sales', tab: 'sales', title: 'See how your store is selling', body: 'Sales shows each week against the same week last year, day by day, and where your store ranks. Items lists what to act on: out of stock, not selling, below or above the chain average. Open an item and press Order this item to jump straight to it.' })
  steps.push({ scene: 'sales', tab: 'order', title: 'Sales on every item', body: 'Open Details on any item in the Order tab to see how it sold at your store in recent weeks, its rank, and the sales lost while it was out of stock. Item sales are before GST and leave out Elfa.' })
  if (isAdmin) steps.push({ scene: 'send', tab: 'sales', title: 'Load the weekly reports', body: 'In Sales, open Upload and add the three Power BI files. Each is checked against its own totals before anything is saved, and a store sees only its own figures.' })
  if (isAdmin) steps.push({ scene: 'pay', tab: 'analytics', title: 'Analytics', body: 'See who is using the app, what they do, any errors, and anything unusual such as a new device or overnight sign-ins.' })
  if (isAdmin) steps.push({ scene: 'stores', tab: 'stores', title: 'Stores and people', body: 'Open a store to add people. Everyone in a store has the same access there. The sync status for each store is shown here too.' })
  steps.push({ scene: 'done', title: 'You are ready', body: 'You can replay this tour from the question mark at the top. If you cannot sign in, contact support@hsw.com.au.' })
  return steps
}

const ink = 'var(--color-ink)'
const line = 'var(--color-ink-2)'

/** The little picture for each step. They move with transform and opacity only, and stand still if motion is reduced. */
function Picture({ scene }: { scene: Scene }): ReactNode {
  const frame = { viewBox: '0 0 160 100', width: 160, height: 100, role: 'img', 'aria-hidden': true as const }
  switch (scene) {
    case 'scan':
      return (
        <svg {...frame}>
          <rect x="30" y="18" width="100" height="64" rx="8" fill="var(--color-paper-3)" stroke={line} />
          {[40, 48, 53, 62, 68, 78, 84, 94, 100, 108, 116].map((x, i) => <rect key={x} x={x} y="30" width={i % 3 === 0 ? 4 : 2} height="40" fill={ink} />)}
          <rect className="tour-sweep" x="34" y="30" width="92" height="3" rx="1.5" fill="var(--color-accent)" />
        </svg>
      )
    case 'phone':
      return (
        <svg {...frame}>
          <rect x="8" y="26" width="32" height="56" rx="6" fill="var(--color-paper-3)" stroke={line} />
          <rect x="16" y="40" width="16" height="10" fill={ink} opacity=".7" />
          <rect x="82" y="22" width="70" height="46" rx="5" fill="var(--color-paper-3)" stroke={line} />
          <rect x="108" y="68" width="18" height="8" fill={line} opacity=".5" />
          <rect x="90" y="30" width="44" height="4" rx="2" fill={line} opacity=".5" />
          <rect className="tour-line l1" x="90" y="40" width="54" height="5" rx="2.5" fill="var(--color-accent)" />
          <rect className="tour-line l2" x="90" y="50" width="40" height="5" rx="2.5" fill="var(--color-accent)" />
          <circle className="tour-dot" cx="44" cy="50" r="4" fill="var(--color-accent)" />
        </svg>
      )
    case 'build':
      return (
        <svg {...frame}>
          <rect x="34" y="10" width="92" height="80" rx="6" fill="var(--color-paper-3)" stroke={line} />
          <rect x="44" y="20" width="40" height="5" rx="2.5" fill={ink} opacity=".7" />
          {[34, 46, 58].map((y, i) => <rect key={y} className={'tour-line l' + (i + 1)} x="44" y={y} width={72 - i * 10} height="6" rx="3" fill="var(--color-accent)" />)}
          <rect x="84" y="72" width="32" height="8" rx="3" fill={ink} opacity=".75" />
        </svg>
      )
    case 'send':
      return (
        <svg {...frame}>
          <rect x="30" y="26" width="100" height="56" rx="6" fill="var(--color-paper-3)" stroke={line} />
          <path d="M34 32l46 30 46-30" fill="none" stroke={line} strokeWidth="2" />
          <g className="tour-fly"><rect x="62" y="6" width="36" height="26" rx="3" fill="var(--color-paper-2)" stroke="var(--color-accent)" strokeWidth="2" /><rect x="68" y="13" width="24" height="3" fill={ink} opacity=".6" /><rect x="68" y="20" width="16" height="3" fill={ink} opacity=".6" /></g>
        </svg>
      )
    case 'docs':
      return (
        <svg {...frame}>
          {[14, 38, 62].map((y, i) => (
            <g key={y} className={'tour-line l' + (i + 1)}>
              <rect x="26" y={y} width="108" height="20" rx="4" fill="var(--color-paper-3)" stroke={line} />
              <rect x="34" y={y + 7} width="34" height="5" rx="2.5" fill={ink} opacity=".6" />
              <rect x="108" y={y + 6} width="18" height="8" rx="4" fill={i === 0 ? 'var(--color-accent)' : line} opacity=".7" />
            </g>
          ))}
        </svg>
      )
    case 'sales':
      return (
        <svg {...frame}>
          {[[58, 70], [40, 56], [24, 44]].map(([a, b], i) => (
            <g key={i}>
              <rect className={'tour-grow g' + (i + 1)} x={30 + i * 40} y={a} width="16" height={86 - a} fill="var(--color-accent)" />
              <rect className={'tour-grow g' + (i + 1)} x={48 + i * 40} y={b} width="16" height={86 - b} fill="var(--color-muted)" />
            </g>
          ))}
          <path d="M22 86h122" stroke={line} strokeWidth="2" />
        </svg>
      )
    case 'pay':
      return (
        <svg {...frame}>
          {[60, 44, 28].map((y, i) => <rect key={y} className={'tour-grow g' + (i + 1)} x={36 + i * 34} y={y} width="22" height={86 - y} fill="var(--color-accent)" />)}
          <path d="M26 86h110" stroke={line} strokeWidth="2" />
        </svg>
      )
    case 'stores':
      return (
        <svg {...frame}>
          <rect x="22" y="40" width="46" height="42" rx="4" fill="var(--color-paper-3)" stroke={line} />
          <path d="M18 42l27-22 27 22" fill="none" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
          {[96, 124].map((cx, i) => (
            <g key={cx} className={'tour-line l' + (i + 1)}>
              <circle cx={cx} cy="38" r="9" fill="var(--color-accent)" />
              <rect x={cx - 13} y="52" width="26" height="22" rx="10" fill="var(--color-accent)" opacity=".7" />
            </g>
          ))}
        </svg>
      )
    case 'done':
      return (
        <svg {...frame}>
          <circle cx="80" cy="50" r="34" fill="var(--color-success-soft)" />
          <path className="tour-tick" d="M64 52l12 12 22-26" fill="none" stroke="var(--color-success)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg {...frame}>
          <rect className="tour-line l1" x="40" y="22" width="80" height="12" rx="6" fill="var(--color-accent)" />
          <rect className="tour-line l2" x="40" y="44" width="64" height="12" rx="6" fill="var(--color-accent)" opacity=".7" />
          <rect className="tour-line l3" x="40" y="66" width="48" height="12" rx="6" fill="var(--color-accent)" opacity=".45" />
        </svg>
      )
  }
}

/** A first-login walkthrough: a card with a moving picture, Back and Next, and a ring around the tab it talks about. */
export default function Tour({ isAdmin, manager, onClose }: Props) {
  const steps = useMemo(() => stepsFor({ isAdmin, manager }), [isAdmin, manager])
  const [i, setI] = useState(0)
  const step = steps[i]
  const last = i === steps.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, steps.length])

  // Ring the tab this step is about.
  useEffect(() => {
    const el = step.tab ? document.querySelector<HTMLElement>(`nav .tab[data-tour="${step.tab}"], .hometile[data-tour="${areaOf(step.tab).id}"]`) : null
    el?.classList.add('tour-hit')
    return () => el?.classList.remove('tour-hit')
  }, [step.tab])

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tourbox">
        <button type="button" className="modal-x" aria-label="Skip the tour" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <div key={i} className="tourstep">
          <div className="tourpic"><Picture scene={step.scene} /></div>
          <h2 id="tour-title">{step.title}</h2>
          <p>{step.body}</p>
        </div>
        <div className="tourfoot">
          <ol className="dots" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((s, n) => <li key={s.title} aria-current={n === i ? 'step' : undefined} />)}
          </ol>
          <div className="actions">
            {i > 0 ? <button type="button" className="btn" onClick={() => setI(i - 1)}>Back</button> : <button type="button" className="btn" onClick={onClose}>Skip</button>}
            <button type="button" className="btn primary" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Start' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
