import { visibleAreas, type AreaId } from './lib/sections'

/** What opens after sign-in: one tile for each area the person can use. The one they used last is marked. */
export default function Home({ isAdmin, last, onPick }: { isAdmin: boolean; last: AreaId | null; onPick: (id: AreaId) => void }) {
  return (
    <div className="homepage">
      <div className="pagehead">
        <div>
          <h1>Home</h1>
          <p className="muted">Choose what you want to do.</p>
        </div>
      </div>
      <div className="hometiles">
        {visibleAreas(isAdmin).map((a) => (
          <button key={a.id} type="button" className={`flagbtn hometile${last === a.id ? ' last' : ''}`} data-tour={a.id} onClick={() => onPick(a.id)}>
            <b>{a.label}</b>
            <span>{a.blurb}</span>
            {last === a.id && <small className="muted">Last used</small>}
          </button>
        ))}
      </div>
    </div>
  )
}
