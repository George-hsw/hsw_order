import type { StoreRow } from './lib/supabase'

// A placeholder: the Transfers screen is being built in its own session and replaces this file.
export default function Transfers({ stores }: { stores: StoreRow[]; multi: boolean; names: Record<string, string> }) {
  return <div className="state"><p>Transfers</p><p className="muted">{stores.length} {stores.length === 1 ? 'store' : 'stores'}</p></div>
}
