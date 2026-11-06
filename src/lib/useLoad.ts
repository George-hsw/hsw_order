import { useCallback, useEffect, useState, type DependencyList } from 'react'

export interface Loaded<T> { data: T | null; failed: boolean; loading: boolean; retry: () => void }

/** Runs a loader when the dependencies change and ignores answers that arrive after they changed again. */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList, enabled = true): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; failed: boolean; loading: boolean }>({ data: null, failed: false, loading: enabled })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) { setState({ data: null, failed: false, loading: false }); return }
    let live = true
    setState({ data: null, failed: false, loading: true })
    load().then((data) => live && setState({ data, failed: false, loading: false })).catch(() => live && setState({ data: null, failed: true, loading: false }))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled])
  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { ...state, retry }
}
