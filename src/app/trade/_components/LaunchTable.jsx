'use client'

import LaunchTableRow from './LaunchTableRow'
import styles from './LaunchTable.module.scss'

// Everything after MCAP is supporting evidence, so the row degrades from the right as the
// viewport narrows — the name, its shape and what it is worth are what survive to a phone.
const COLUMNS = [
  { key: 'rank', label: '#', className: 'table__rank' },
  { key: 'coin', label: 'Coin', className: 'table__coin' },
  { key: 'price', label: 'Price', className: 'table__figure' },
  { key: 'mcap', label: 'Mcap', className: 'table__figure' },
  { key: 'liq', label: 'Liquidity', className: 'table__figure' },
  { key: 'age', label: 'Age', className: 'table__figure' },
  { key: 'txns', label: 'Txns', className: 'table__figure' },
  { key: 'vol', label: '24h vol', className: 'table__figure' },
  { key: 'traders', label: 'Traders', className: 'table__figure' },
  { key: 'h1', label: '1h', className: 'table__change' },
  { key: 'h6', label: '6h', className: 'table__change' },
  { key: 'h24', label: '24h', className: 'table__change' },
  { key: 'buy', label: '', className: 'table__action' },
]

/**
 * Launch Table
 * The explorer's dense view: one launch per line, every figure the same distance from its
 * neighbours so a column can be read down rather than across.
 *
 * A real `<table>` rather than a grid of divs. The relationships here are genuinely tabular — a
 * screen reader announcing "Mcap, $161.1K" is the whole point — and the header row is what makes
 * a column of bare numbers mean anything.
 *
 * Sorting lives on the toolbar's tabs above, not on these headers: the five sorts that matter are
 * already one press away up there, and a second sorting control that disagreed with the first
 * would be worse than none.
 */
const LaunchTable = ({ tokens, offset = 0 }) => (
  // Its own scroller: a dozen columns will not fit a phone, and the page body must never be the
  // thing that scrolls sideways
  <div className={styles.table__scroller}>
    <table className={styles.table}>
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column.key} className={styles[column.className]} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tokens.map((token, index) => (
          <LaunchTableRow key={token.key} token={token} rank={offset + index + 1} />
        ))}
      </tbody>
    </table>
  </div>
)

export default LaunchTable
