import { supabase } from './supabase'

/**
 * A small cache kept in the browser (IndexedDB), so data that only changes overnight, such as a store's stock and sales rates, is read from the
 * device after the first load instead of being fetched again. Everything is optional: if IndexedDB is blocked or full, the app simply loads as before.
 * It is emptied when anyone signs out, so a shared device never keeps another person's store data.
 */
const DB_NAME = 'hsw-cache'
const TABLE = 'kv'
const MAX_AGE = 24 * 36e5 // nothing is trusted for more than a day, whatever else says it is still current

let opened: Promise<IDBDatabase | null> | null = null
const open = (): Promise<IDBDatabase | null> => (opened ??= new Promise((resolve) => {
  try {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(TABLE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  } catch { resolve(null) }
}))

const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = f(db.transaction(TABLE, mode).objectStore(TABLE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

interface Entry<T> { at: number; tag: string; value: T }

/** The saved value for a key, only if it was saved with the same tag (what it was current as of) and is under a day old. */
export async function persistGet<T>(key: string, tag: string): Promise<T | undefined> {
  const hit = (await run<Entry<T> | undefined>('readonly', (s) => s.get(key))) as Entry<T> | undefined
  return hit && hit.tag === tag && Date.now() - hit.at < MAX_AGE ? hit.value : undefined
}

export async function persistSet<T>(key: string, tag: string, value: T): Promise<void> {
  await run('readwrite', (s) => s.put({ at: Date.now(), tag, value } satisfies Entry<T>, key))
}

export async function persistClear(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}

supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') void persistClear() })
