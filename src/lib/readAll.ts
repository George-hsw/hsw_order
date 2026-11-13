// Reading every row of a query, a page at a time. No imports on purpose: both the orders and the sales code use it, and a shared file that imports nothing cannot create a loop.

const PAGE = 1000 // Supabase returns at most 1,000 rows a request

type Page = { data: unknown; error: { message: string } | null; count?: number | null }

/**
 * Reads every row of a query. The first page also asks for the total, then every remaining page is requested at once, so a
 * 4,400-row list takes about two round trips instead of five in a row. The query must be ordered so pages never overlap.
 */
export async function readAll<T>(build: (from: number, to: number, count: boolean) => PromiseLike<Page>): Promise<T[]> {
  const first = await build(0, PAGE - 1, true)
  if (first.error) throw new Error(first.error.message)
  const rows = (first.data ?? []) as T[]
  const total = first.count ?? rows.length
  if (rows.length < PAGE || total <= PAGE) return rows
  const starts = Array.from({ length: Math.ceil((total - PAGE) / PAGE) }, (_, i) => PAGE * (i + 1))
  const rest = await Promise.all(starts.map((from) => build(from, from + PAGE - 1, false)))
  for (const r of rest) {
    if (r.error) throw new Error(r.error.message)
    rows.push(...((r.data ?? []) as T[]))
  }
  return rows
}
export const countOpt = (count: boolean) => (count ? { count: 'exact' as const } : {})
