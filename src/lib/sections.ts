/** The areas of the app, as shown on Home, and the tabs inside each. Adding an area later is one more entry here. */
export type Tab = 'new' | 'docs' | 'reports' | 'order' | 'orders' | 'count' | 'counts' | 'price' | 'tansel' | 'sales' | 'analytics' | 'stores' | 'users' | 'closures' | 'transfers'
export type AreaId = 'quote' | 'order' | 'transfer' | 'stocktake' | 'price' | 'sales' | 'admin'

export interface Area {
  id: AreaId
  label: string
  blurb: string
  adminOnly?: boolean
  opsLabel?: string // what operations people see in place of label and blurb
  opsBlurb?: string
  tabs: { tab: Tab; label: string; needsStore?: boolean; needsOps?: boolean }[] // needsStore: only people who work in a store (Reports). needsOps: only operations people and admins (Closures)
}

export const AREAS: Area[] = [
  { id: 'quote', label: 'Quote', blurb: 'Quotes, tax invoices, payments and Tansel pull-outs.',
    tabs: [{ tab: 'new', label: 'New' }, { tab: 'docs', label: 'Documents' }, { tab: 'reports', label: 'Reports', needsStore: true }, { tab: 'tansel', label: 'Tansel' }] },
  { id: 'order', label: 'Order', blurb: 'Order stock, and find past orders.',
    tabs: [{ tab: 'order', label: 'Order', needsStore: true }, { tab: 'orders', label: 'Orders', needsStore: true }] },
  { id: 'transfer', label: 'Stock transfers', blurb: 'Stock sent to your store by management, to copy into NAV.', opsLabel: 'Transfer', opsBlurb: 'Push items to stores, or share a closing store’s stock, and see how stores answer.',
    tabs: [{ tab: 'transfers', label: 'Stock transfers', needsStore: true }, { tab: 'closures', label: 'Transfers', needsOps: true }] },
  { id: 'stocktake', label: 'Stock take', blurb: 'Count the whole store, or one vendor or category, and copy the adjustments for NAV.',
    tabs: [{ tab: 'count', label: 'Count' }, { tab: 'counts', label: 'Counts' }] },
  { id: 'price', label: 'Price check', blurb: 'Scan an item for its price and stock, see how it has sold, print a label.',
    tabs: [{ tab: 'price', label: 'Price check' }] },
  { id: 'sales', label: 'Sales', blurb: 'See how your store is selling and what to act on.',
    tabs: [{ tab: 'sales', label: 'Sales' }] },
  { id: 'admin', label: 'Admin', blurb: 'Usage and errors, stores and people.', adminOnly: true,
    tabs: [{ tab: 'analytics', label: 'Analytics' }, { tab: 'stores', label: 'Stores' }, { tab: 'users', label: 'Users' }] },
]

export const areaOf = (tab: Tab): Area => AREAS.find((a) => a.tabs.some((t) => t.tab === tab)) ?? AREAS[0]

/** The areas this person may open. */
export const visibleAreas = (isAdmin: boolean, works = true, isOps = false): Area[] => AREAS.filter((a) => (!a.adminOnly || isAdmin) && (works || a.id === 'sales' || (isOps && a.id === 'transfer'))) // works: belongs to a store. A manager with no store of their own sees Sales only

/** An area's name and description for this person: operations see Transfer, everyone else Stock transfers. */
export const areaText = (a: Area, isOps: boolean) => ({ label: isOps && a.opsLabel ? a.opsLabel : a.label, blurb: isOps && a.opsBlurb ? a.opsBlurb : a.blurb })

/** The tabs of one area this person may open. */
export const visibleTabs = (area: Area, works: boolean, isOps = false): Area['tabs'] => area.tabs.filter((t) => (!t.needsStore || works) && (!t.needsOps || isOps))

export const isAreaId = (v: string | null): v is AreaId => AREAS.some((a) => a.id === v)
