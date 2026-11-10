/** The areas of the app, as shown on Home, and the tabs inside each. Adding an area later is one more entry here. */
export type Tab = 'new' | 'docs' | 'reports' | 'order' | 'orders' | 'price' | 'tansel' | 'sales' | 'analytics' | 'stores'
export type AreaId = 'quote' | 'order' | 'price' | 'sales' | 'admin'

export interface Area {
  id: AreaId
  label: string
  blurb: string
  adminOnly?: boolean
  tabs: { tab: Tab; label: string; needsStore?: boolean }[] // needsStore: only people who work in a store (Reports)
}

export const AREAS: Area[] = [
  { id: 'quote', label: 'Quote', blurb: 'Quotes, tax invoices, payments and Tansel pull-outs.',
    tabs: [{ tab: 'new', label: 'New' }, { tab: 'docs', label: 'Documents' }, { tab: 'reports', label: 'Reports', needsStore: true }, { tab: 'tansel', label: 'Tansel' }] },
  { id: 'order', label: 'Order', blurb: 'Order stock, and find past orders.',
    tabs: [{ tab: 'order', label: 'Order' }, { tab: 'orders', label: 'Orders' }] },
  { id: 'price', label: 'Price check', blurb: 'Scan an item for its price and stock, see how it has sold, print a label.',
    tabs: [{ tab: 'price', label: 'Price check' }] },
  { id: 'sales', label: 'Sales', blurb: 'See how your store is selling and what to act on.',
    tabs: [{ tab: 'sales', label: 'Sales' }] },
  { id: 'admin', label: 'Admin', blurb: 'Usage and errors, stores and people.', adminOnly: true,
    tabs: [{ tab: 'analytics', label: 'Analytics' }, { tab: 'stores', label: 'Stores' }] },
]

export const areaOf = (tab: Tab): Area => AREAS.find((a) => a.tabs.some((t) => t.tab === tab)) ?? AREAS[0]

/** The areas this person may open. */
export const visibleAreas = (isAdmin: boolean): Area[] => AREAS.filter((a) => !a.adminOnly || isAdmin)

/** The tabs of one area this person may open. */
export const visibleTabs = (area: Area, works: boolean): Area['tabs'] => area.tabs.filter((t) => !t.needsStore || works)

export const isAreaId = (v: string | null): v is AreaId => AREAS.some((a) => a.id === v)
