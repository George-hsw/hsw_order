export interface HoldLine { code: string; description: string; min: number; stock: number; onOrder: number; toOrder: number }

/**
 * Items operations wants this store to always have in stock. An item below its minimum is already in the Suggested order;
 * this list shows every held item for the vendor and whether it is covered.
 */
export default function HoldPane({ vendor, lines }: { vendor: string; lines: HoldLine[] }) {
  if (lines.length === 0) {
    return <div className="state"><p>No held items for {vendor}</p><p className="muted">When operations asks for items to be always in stock here, they are listed on this tab, and ordered through the Suggested order whenever they fall below the minimum.</p></div>
  }
  return (
    <section className="prepared" aria-label={`Held items for ${vendor}`}>
      <p className="muted">Operations wants these always in stock. Anything below its minimum is in the Suggested order.</p>
      <div className="tablewrap">
        <table className="book holdlist">
          <thead><tr><th>Item</th><th>Description</th><th className="r">Minimum</th><th className="r">In stock</th><th className="r">On order</th><th className="r">To order</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.code}>
                <td data-label="Item" className="num">{l.code}</td>
                <td data-label="Description" className="desc">{l.description}</td>
                <td data-label="Minimum" className="r">{l.min}</td>
                <td data-label="In stock" className="r">{l.stock}</td>
                <td data-label="On order" className="r">{l.onOrder}</td>
                <td data-label="To order" className="r">{l.toOrder > 0 ? <span className="chk warn">{l.toOrder}</span> : <span className="chk ok">Covered</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
