import { type ReactNode } from 'react'

/** A few soft bars where a screen is still loading. They pulse gently; screen readers are told it is loading. */
export default function Loading({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <i key={i} />)}
    </div>
  )
}
