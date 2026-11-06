import { DEMO, supabase } from '../supabase'
import { demoEvents } from './demoEvents'
import type { AppEvent } from './model'

const PAGE = 1000
const MAX = 30000 // more than this in a period and the screen says it is showing the newest

/** The events since a time, newest first. Admin only: Row Level Security returns nothing to anyone else. */
export async function loadEvents(since: Date): Promise<{ events: AppEvent[]; truncated: boolean }> {
  if (DEMO) return new Promise((r) => setTimeout(() => r({ events: demoEvents().filter((e) => e.at >= since.toISOString()), truncated: false }), 150))
  if (!supabase) throw new Error('No Supabase connection')
  const out: AppEvent[] = []
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await supabase.from('app_events').select('id,at,email,store_id,session_id,kind,detail,device,device_id').gte('at', since.toISOString())
      .order('at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as AppEvent[]))
    if (!data || data.length < PAGE) return { events: out, truncated: false }
  }
  return { events: out, truncated: true }
}

export async function pruneEvents(): Promise<number> {
  if (DEMO || !supabase) return 0
  const { data, error } = await supabase.rpc('app_events_prune', { p_days: 180 })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
