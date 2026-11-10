// The Tansel Pull-Out Finder, ported from the store's Excel file (Tansel_Pull-Out_Finder.xlsx) formula by formula.
// It works out which Tansel basket, slides and battens fit a cabinet. There are no prices here, on purpose: prices come
// from the item list. The names in comments (K10, K46 ...) are the workbook's own helper cells, so the two can be compared.
import data from '../data/tansel.json'

export type Product = 'baskets' | 'laundry' | 'undersink' | 'frame'
export type MountPref = 'auto' | 'bottom' | 'side'
export type Mount = 'B' | 'S' | 'N' | ''
export type Hinges = 'left' | 'right' | 'both' | 'none'
export type RackModel = 'auto' | 'TAN040' | 'TAN050' | 'TAN051' | 'TAN052'

/** What staff type in. A blank box is 0 (or the default shown beside it). Everything is millimetres. */
export interface CabinetInput {
  product: Product
  mount: MountPref
  across: 1 | 2 | 3 // bottom mount: baskets side by side
  depthChoice: 'auto' | 485 | 400 | 600
  width: number // internal cabinet width
  depth: number // internal cabinet depth
  fixedShelves: boolean
  heightFree: number // height with all shelves removed (adjustable shelves)
  heightFixed: number // height between fixed shelves
  hinges: Hinges
  hingeWidth: number // 0 = assume the default
  count: number // baskets; 0 = recommended
  tall: number // of those, how many 150 mm high
  calico: boolean
  rack: RackModel
  units: number // laundry or under-sink units
  mf100: number
  mf200: number
  mf300: number
}

export const BLANK: CabinetInput = {
  product: 'baskets', mount: 'auto', across: 1, depthChoice: 'auto', width: 0, depth: 0, fixedShelves: false, heightFree: 0, heightFixed: 0,
  hinges: 'left', hingeWidth: 0, count: 0, tall: 0, calico: false, rack: 'auto', units: 1, mf100: 0, mf200: 0, mf300: 0,
}

/** The pantry the workbook's Example tab uses, for training. */
export const EXAMPLE: CabinetInput = { ...BLANK, width: 568, depth: 560, heightFree: 1400, hinges: 'right', hingeWidth: 22, tall: 1 }

// The workbook's Settings tab. Change these only if Tansel confirms different numbers.
export const SETTINGS = {
  sideTol: 1, spMax: 72, spMin: 64, offN: 24, clears: 25, defaultHinge: 25, offB: 27, tolB: 1, pitch: 250, depthMargin: 0,
  ldyH: 500, usrH: 430, raise: 10, mfH: 580, mfD: 490, mfExtra: 30, weight: 40, weightCut: 10, discsLayer: 4, discsPack: 12,
}
const S = SETTINGS

const PACKS = data.packs as number[][]
const PCOL = { left: 0, right: 1, total: 2, pieces: 3, score: 4, descL: 5, descR: 6, n11: 7, n16: 8, n18: 9, n21: 10, n25: 11, spacers: 12, batten: 13 }
const DESCS = data.descs as string[]
const CODES = new Map<string, { code: string; desc: string }>((data.codes as string[][]).map(([k, code, desc]) => [k, { code, desc }]))
const has = (key: string) => CODES.has(key)

export const describeCode = (code: string): string => [...CODES.values()].find((c) => c.code === code)?.desc ?? ''

/** Does any packer combination exist with these limits? (COUNTIFS) and the lowest score among them (MINIFS). */
const packRows = (minL: number, minR: number, minTot: number, maxTot: number, exactTot?: number): number[] => {
  const out: number[] = []
  for (let i = 0; i < PACKS.length; i++) {
    const p = PACKS[i]
    if (exactTot !== undefined) { if (p[PCOL.total] === exactTot) out.push(i); continue }
    if (p[PCOL.left] >= minL && p[PCOL.right] >= minR && p[PCOL.total] >= minTot && p[PCOL.total] <= maxTot) out.push(i)
  }
  return out
}
const lowestScore = (rows: number[]) => rows.reduce((m, i) => Math.min(m, PACKS[i][PCOL.score]), Infinity)
const rowOfScore = (score: number) => PACKS.findIndex((p) => p[PCOL.score] === score) // -1 when none; the workbook's MATCH is 1-based
const fmt1 = (n: number) => String(Math.round(n * 10) / 10) // TEXT(n,"0.#")

const WIDTHS = Array.from({ length: 17 }, (_, i) => 100 + 50 * i) // 100 ... 900

export interface CodeLine { code: string; description: string; qty: number }
export interface MountRow { label: string; star: boolean; biggest: string; left: string; right: string; spacer: string; weight: string }
export interface Result {
  fits: boolean
  headline: string // the RESULT box
  pick: string
  slides: string
  packersLeft: string
  packersRight: string
  weight: string
  height: string
  depthCheck: string
  notes: string
  compare: MountRow[]
  codes: CodeLine[]
}

const FRAME_NAME = 'Multi-frame'

export function fit(c: CabinetInput): Result {
  const fam = c.product === 'baskets' ? 'BSK' : c.product === 'laundry' ? 'LDY' : c.product === 'undersink' ? 'USR' : 'MF'
  const W = c.width, D = c.depth // K10 and C15
  const autoDepth = c.depthChoice === 'auto'
  const split = fam === 'BSK' ? c.across : 1 // K22
  const hingeW = c.hingeWidth > 0 ? c.hingeWidth : S.defaultHinge // K6
  const hL = c.hinges === 'left' || c.hinges === 'both' ? hingeW : 0 // K7
  const hR = c.hinges === 'right' || c.hinges === 'both' ? hingeW : 0 // K8
  const hasHinge = hL + hR > 0 // K9
  const clear = W - hL - hR // K11
  const reqL = Math.max(0, hL - S.clears), reqR = Math.max(0, hR - S.clears) // K12, K13
  const H = c.fixedShelves ? c.heightFixed : c.heightFree // K5
  const recBaskets = Math.floor(H / S.pitch) // K14
  const total = fam === 'BSK' ? (c.count > 0 ? c.count : recBaskets) : 0 // K15
  const q150 = fam === 'BSK' ? Math.min(c.tall, total) : 0 // K16
  const q100 = total - q150 // K17
  const levels = fam === 'BSK' ? total : fam === 'LDY' || fam === 'USR' ? c.units : 0 // K18

  // K3: basket depth
  const sideCap = 550 + S.spMax + S.sideTol
  const depth = fam !== 'BSK' ? 485
    : autoDepth ? (D >= 600 + S.depthMargin && (W <= sideCap || split > 1) ? 600 : D >= 485 + S.depthMargin ? 485 : D >= 400 + S.depthMargin ? 400 : 0)
      : Number(c.depthChoice)
  const depthOK = fam === 'MF' ? D >= S.mfD : depth > 0 && D >= depth + S.depthMargin // K4
  const usrSel = c.rack // K23
  const usrW = usrSel === 'TAN040' ? 100 : usrSel === 'TAN050' ? 150 : usrSel === 'TAN051' || usrSel === 'TAN052' ? 200 : 0 // K24

  // The width grid, rows 27 to 43
  const avail = (w: number): boolean => {
    if (fam === 'BSK') {
      if ((q100 > 0 || total === 0) && !has(`BSK|${depth}|100|${w}`)) return false
      if (q150 > 0 && !has(`BSK|${depth}|150|${w}`)) return false
      return true
    }
    if (fam === 'LDY') return w === 300 || w === 400 || w === 500
    if (fam === 'USR') return usrSel === 'auto' ? w === 100 || w === 150 || w === 200 : w === usrW
    return false
  }
  let Wb = 0, Ws = 0, Wn = 0 // K46, K47, K48
  for (const w of WIDTHS) {
    if (!avail(w)) continue
    if (clear >= w + S.offB + S.tolB) Wb = Math.max(Wb, w)
    const hiS = W - w - S.spMin + S.sideTol, loS = W - w - S.spMax - S.sideTol
    if (hiS >= 0 && packRows(reqL, reqR, Math.max(0, loS), hiS).length > 0) Ws = Math.max(Ws, w)
    const hiN = W - w - S.offN + S.sideTol, loN = W - w - S.offN - S.sideTol
    // COUNTIFS on the total only: the left and right limits are not used for the no-spacer mount
    if (!hasHinge && hiN >= 0 && PACKS.some((p) => p[PCOL.total] >= Math.max(0, loN) && p[PCOL.total] <= hiN)) Wn = Math.max(Wn, w)
  }

  // The packers for the spacer mount (K49 to K54) and the no-spacer mount (K55 to K57)
  let rowS = -1, rowN = -1
  if (Ws > 0) {
    const loTol = W - Ws - S.spMax - S.sideTol, hiTol = W - Ws - S.spMin + S.sideTol
    rowS = rowOfScore(lowestScore(packRows(reqL, reqR, Math.max(0, loTol), hiTol)))
  }
  if (Wn > 0) {
    const target = W - Wn - S.offN
    const exact = PACKS.filter((p) => p[PCOL.total] === target)
    const rows = exact.length > 0 ? packRows(0, 0, 0, 0, target) : PACKS.map((_, i) => i).filter((i) => PACKS[i][PCOL.total] >= Math.max(0, target - S.sideTol) && PACKS[i][PCOL.total] <= target + S.sideTol)
    rowN = rowOfScore(lowestScore(rows))
  }
  const piecesS = rowS >= 0 ? PACKS[rowS][PCOL.pieces] : 0 // K58
  const piecesN = rowN >= 0 ? PACKS[rowN][PCOL.pieces] : 0 // K59
  const maxW = Math.max(Wb, Ws, Wn) // K60
  const rankB = maxW > 0 && Wb === maxW ? 1 : 9999
  const rankS = maxW > 0 && Ws === maxW ? piecesS * 10 : 9999
  const rankN = maxW > 0 && Wn === maxW ? piecesN * 10 + 2 : 9999
  const lowest = Math.min(rankB, rankS, rankN)
  const autoMount: Mount = maxW === 0 ? '' : rankS === lowest ? 'S' : rankB === lowest ? 'B' : 'N' // K64
  const sideBest: Mount = hasHinge ? 'S' : Ws > Wn ? 'S' : Wn > Ws ? 'N' : piecesN < piecesS ? 'N' : 'S' // K66
  const mount: Mount = fam === 'MF' ? '' : split > 1 ? 'B' : c.mount === 'bottom' ? 'B' : c.mount === 'side' ? sideBest : autoMount // K67
  const wide = mount === 'B' ? Wb : mount === 'S' ? Ws : mount === 'N' ? Wn : 0 // K68
  const pairRow = mount === 'S' && Ws > 0 ? rowS : mount === 'N' && Wn > 0 ? rowN : -1 // K69
  const pair = pairRow >= 0 ? PACKS[pairRow] : null
  const battens = pair ? pair[PCOL.batten] === 1 : false // K70
  const weight = S.weight - (battens ? S.weightCut : 0) // K71

  // Splitting a wide space into 2 or 3 bottom-mount baskets (K72 to K79)
  const splitTotal = split > 1 ? Math.min(split * (depth === 600 ? 550 : 900), Math.floor((clear - split * S.offB - S.tolB) / 50) * 50) : 0
  const splitBase = split > 1 ? Math.floor(splitTotal / split / 50) * 50 : 0
  const splitExtra = split > 1 ? (splitTotal - split * splitBase) / 50 : 0
  const WA = split === 1 ? wide : splitExtra > 0 ? splitBase + 50 : splitBase
  const nA = split === 1 ? 1 : splitExtra > 0 ? splitExtra : split
  const WB = split > 1 && splitExtra > 0 ? splitBase : 0
  const nB = split > 1 && splitExtra > 0 ? split - splitExtra : 0
  const splitOK = split === 1 ? true : splitBase >= 100

  const needH = fam === 'LDY' ? S.ldyH + (mount === 'B' ? S.raise : 0) : fam === 'USR' ? S.usrH + (mount === 'B' ? S.raise : 0) : fam === 'MF' ? S.mfH : S.pitch // K80
  const heightOK = H >= needH // K81
  const mfWidest = clear >= 300 + S.mfExtra ? 300 : clear >= 200 + S.mfExtra ? 200 : clear >= 100 + S.mfExtra ? 100 : 0 // K82
  const mfNeed = c.mf300 > 0 ? 300 : c.mf200 > 0 ? 200 : c.mf100 > 0 ? 100 : 0 // K83
  const mfQty = c.mf100 + c.mf200 + c.mf300 // K84

  // Codes from the table (K85 to K95)
  const look = (key: string) => CODES.get(key)?.code
  const basketCode = (wd: number, h: 100 | 150) => look(`BSK|${depth}|${h}|${wd}`) ?? 'MISSING'
  const codeA100 = fam === 'BSK' && WA > 0 && q100 > 0 ? basketCode(WA, 100) : ''
  const codeA150 = fam === 'BSK' && WA > 0 && q150 > 0 ? basketCode(WA, 150) : ''
  const codeB100 = fam === 'BSK' && WB > 0 && q100 > 0 ? basketCode(WB, 100) : ''
  const codeB150 = fam === 'BSK' && WB > 0 && q150 > 0 ? basketCode(WB, 150) : ''
  const insA = fam === 'BSK' && WA > 0 ? look(`INS|${depth}|${WA}`) ?? 'MISSING' : ''
  const insB = fam === 'BSK' && WB > 0 ? look(`INS|${depth}|${WB}`) ?? 'MISSING' : ''
  const unitCode = wide === 0 ? '' : fam === 'LDY' ? look(`LDY|${wide}`) ?? '' : fam === 'USR' ? (usrSel === 'auto' ? (wide === 100 ? 'TAN040' : wide === 150 ? 'TAN050' : 'TAN052') : usrSel) : ''
  const usrInsT = fam === 'USR' && unitCode ? look(`USRT|${unitCode}`) ?? '' : ''
  const usrInsB = fam === 'USR' && unitCode ? look(`USRB|${unitCode}`) ?? '' : ''
  const slideCode = mount === '' || wide === 0 ? '' : look(`SLIDE|${depth}|${mount}`) ?? ''
  const spacerEach = mount === 'S' && pair ? Math.max(S.spMin / 2, Math.min(S.spMax / 2, (W - wide - pair[PCOL.total]) / 2)) : 0
  const missing = [codeA100, codeA150, codeB100, codeB150, insA, insB].includes('MISSING')

  // The RESULT box (B35)
  const small = (n: number) => n > 0 && n < 100
  let headline: string
  if (small(W) || small(D) || small(H)) headline = '✗ CHECK YOUR NUMBERS - type MILLIMETRES (e.g. 568), not centimetres'
  else if (W === 0) headline = 'Enter the internal cabinet width (step 2)'
  else if (D === 0) headline = 'Enter the internal cabinet depth (step 2)'
  else if (H === 0) headline = 'Enter the cabinet height (step 2)'
  else if (!depthOK) headline = `✗ CABINET TOO SHALLOW - need at least ${fam === 'MF' ? S.mfD : (fam === 'BSK' ? 400 : 485) + S.depthMargin}mm deep. Call Tansel 02 9440 9800`
  else if (fam === 'MF') {
    if (mfWidest === 0) headline = `✗ TOO NARROW for the multi-frame (needs ${100 + S.mfExtra}mm clear of hinges)`
    else if (mfNeed > mfWidest) headline = `✗ A ${mfNeed}mm basket will not fit - widest that fits is ${mfWidest}mm`
    else if (!heightOK) headline = `✗ NOT ENOUGH HEIGHT - frame needs ${S.mfH}mm, cabinet has ${H}mm`
    else if (mfQty === 0) headline = `✓ Frame fits (up to ${mfWidest}mm wide baskets) - now enter how many baskets (step 4)`
    else headline = '✓ IT FITS - see the set-up below'
  } else if (!heightOK) {
    headline = `✗ NOT ENOUGH HEIGHT - needs ${needH}mm, cabinet has ${H}mm${mount === 'B' && (fam === 'LDY' || fam === 'USR') && H >= needH - S.raise && Ws > 0 ? ' - change Mount preference to Side mount (no height added)' : ''}`
  } else if (split > 1 && !splitOK) headline = `✗ Too narrow to split into ${split} baskets - choose fewer`
  else if (split === 1 && maxW === 0) headline = '✗ NOTHING FITS this width - call Tansel 02 9440 9800 for a custom solution'
  else if (split === 1 && wide === 0) headline = `✗ Nothing fits with ${c.mount === 'bottom' ? 'Bottom mount' : c.mount === 'side' ? 'Side mount' : 'Recommended'} - change Mount preference to Recommended`
  else if (missing) headline = "✗ That width isn't made in this height/depth - change the 150mm-high count or depth"
  else headline = '✓ IT FITS - see the set-up below'
  const fits = headline.startsWith('✓')

  // What to pick, slides, packers, weight (C37 to C41)
  const pickText = !fits ? '' : fam === 'BSK'
    ? `${split === 1 ? `${WA}mm wide basket` : `${nA} x ${WA}mm${nB > 0 ? ` + ${nB} x ${WB}mm` : ''} baskets side by side`}, ${depth}mm deep${depth !== 485 ? ' (SPECIAL ORDER)' : ''}  -  ${total}${split > 1 ? ' levels high' : total === 1 ? ' basket high' : ' baskets high'}: ${q100 > 0 ? `${q100} x 100mm high` : ''}${q100 > 0 && q150 > 0 ? ' + ' : ''}${q150 > 0 ? `${q150} x 150mm high` : ''}`
    : fam === 'LDY' ? `${levels} x ${wide}mm laundry hamper (${unitCode})${c.calico ? ' + calico bag' : ''}`
      : fam === 'USR' ? `${levels} x under-sink double rack ${unitCode}`
        : `${FRAME_NAME} TAN055 + ${[c.mf100 > 0 ? `${c.mf100} x 100W` : '', c.mf200 > 0 ? `${c.mf200} x 200W` : '', c.mf300 > 0 ? `${c.mf300} x 300W` : ''].filter(Boolean).join(' ')} hanging baskets`
  const slidesText = !fits ? '' : fam === 'MF' ? 'Frame fixes to ONE side wall - fit it on the side WITHOUT hinges'
    : mount === 'B' ? `Bottom mount slides (${slideCode}) - one pair per basket${split > 1 ? ` (${split} pairs per level)` : ''}`
      : mount === 'S' ? `Side mount slides with ADJUSTABLE spacer (${slideCode}) - set spacer to about ${fmt1(spacerEach)}mm each side`
        : `Side mount slides, NO spacer (${slideCode}) - must be exact +/-${S.sideTol}mm`
  const packers = (side: 'L' | 'R'): string => {
    if (!fits) return ''
    if (fam === 'MF') return '-'
    const h = side === 'L' ? hL : hR
    if (mount === 'B') return h > 0 ? `None - but keep the slide/basket at least ${h + 1}mm in from the ${side === 'L' ? 'left' : 'right'} wall to clear the hinge` : 'None needed'
    const d = pair ? DESCS[pair[side === 'L' ? PCOL.descL : PCOL.descR]] : ''
    return d + (mount === 'S' && h > 0 ? ' (spacer clears the hinge)' : '')
  }
  const weightText = !fits || fam === 'MF' ? '' : `${weight} kg per drawer${battens ? `  (reduced by ${S.weightCut}kg because battens are used)` : ''}`

  const heightText = H === 0 ? '' : fam === 'BSK'
    ? `Recommended: ${recBaskets} baskets (${H}mm height, 1 per ${S.pitch}mm)${c.count > 0 ? `   |   Customer chose ${total}${total > recBaskets ? ' - MORE than recommended, check their items will fit' : total < recBaskets ? ' - fewer than recommended (taller items)' : ''}` : ''}`
    : heightOK ? `✓ OK - needs ${needH}mm${mount === 'B' && (fam === 'LDY' || fam === 'USR') ? ` (incl. ${S.raise}mm for bottom mount)` : ''}, cabinet has ${H}mm` : `✗ Needs ${needH}mm, cabinet only has ${H}mm`
  const depthText = D === 0 ? '' : depthOK ? `✓ OK - ${D}mm deep${fam === 'BSK' ? ` (using ${depth}mm deep baskets)` : ''}` : `✗ Too shallow - ${D}mm`

  // Notes for staff (C44)
  let notes: string
  if (!fits) notes = W > 0 && maxW === 0 && fam !== 'MF' ? 'Tansel can do non-standard sizes (400/600/700 deep, 200H, corner units). Call 02 9440 9800 or email sales2@tansel.com.au with measurements + photos.' : ''
  else {
    const n: string[] = []
    if (depth !== 485) n.push('400/600 deep baskets are SPECIAL ORDER - confirm with Tansel.')
    if (pair && pair[PCOL.total] > 0) n.push('Packers listed are for EACH drawer - the code list multiplies them.')
    if (mount === 'S' && reqL + reqR > 0) n.push(`Hinge is bigger than ${S.clears}mm so it is packed out on that side.`)
    if (hasHinge && mount === 'S') n.push(`Cabinet has hinges, so side mount = spacer slides (${slideCode}).`)
    if (mount !== '' && autoMount !== '' && mount !== autoMount && split === 1) n.push('The Recommended mount would be different - see the comparison below.')
    if (fam === 'BSK' && split === 1 && Wb >= 600) n.push('Tip: this space could also take 2 smaller bottom-mount baskets side by side.')
    if (fam === 'USR' && usrSel === 'auto' && wide === 200) n.push('TAN051 (100mm top) also fits - pick the one that clears the plumbing.')
    if (fam === 'USR') n.push('Check the sink plumbing/waste pipes before ordering.')
    if (fam === 'BSK' && depth === 485 && D >= 600 + S.depthMargin && autoDepth) n.push('Cabinet is deep enough for 600mm deep baskets, but they only come up to 550mm wide - choose 2 baskets side by side to use 600 deep.')
    if (fam === 'BSK' && depth === 600 && autoDepth) n.push('485 deep (APL, in stock) also fits - choose 485 in Basket depth if the customer prefers stock.')
    if (fam === 'MF') n.push(`Widest basket that fits: ${mfWidest}mm.`)
    notes = n.join(' ')
  }

  // All mounting options compared (rows 48 to 50)
  const blank = fam === 'MF' || W === 0
  const row = (label: string, star: boolean, biggest: string, left: string, right: string, spacer: string, wt: string): MountRow => ({ label, star, biggest, left, right, spacer, weight: wt })
  const compare: MountRow[] = blank ? [] : [
    row('Bottom mount', autoMount === 'B', Wb === 0 ? "Doesn't fit" : `${Wb}mm`, Wb === 0 ? '' : 'None', Wb === 0 ? '' : 'None', Wb === 0 ? '' : `${clear - Wb - S.offB}mm spare`, Wb === 0 ? '' : `${S.weight}kg`),
    row('Side mount WITH spacer (TAN070)', autoMount === 'S', Ws === 0 ? "Doesn't fit" : `${Ws}mm`,
      Ws === 0 || rowS < 0 ? '' : DESCS[PACKS[rowS][PCOL.descL]], Ws === 0 || rowS < 0 ? '' : DESCS[PACKS[rowS][PCOL.descR]],
      Ws === 0 || rowS < 0 ? '' : `~${fmt1(Math.max(S.spMin / 2, Math.min(S.spMax / 2, (W - Ws - PACKS[rowS][PCOL.total]) / 2)))}mm each side`,
      Ws === 0 || rowS < 0 ? '' : `${S.weight - (PACKS[rowS][PCOL.batten] === 1 ? S.weightCut : 0)}kg`),
    row('Side mount NO spacer (TAN071)', autoMount === 'N', hasHinge ? 'Not used - cabinet has hinges' : Wn === 0 ? "Doesn't fit" : `${Wn}mm`,
      Wn === 0 || rowN < 0 ? '' : DESCS[PACKS[rowN][PCOL.descL]], Wn === 0 || rowN < 0 ? '' : DESCS[PACKS[rowN][PCOL.descR]],
      Wn === 0 || rowN < 0 ? '' : `${W - Wn - PACKS[rowN][PCOL.total] - S.offN}mm`,
      Wn === 0 || rowN < 0 ? '' : `${S.weight - (PACKS[rowN][PCOL.batten] === 1 ? S.weightCut : 0)}kg`),
  ]

  // The code list (rows 54 to 76): one line per item, in this order, skipping empty ones
  const raw: [string, number][] = []
  if (fits) {
    const p = pair
    const n = (key: keyof typeof PCOL) => (p ? p[PCOL[key]] * levels : 0)
    raw.push([codeA100, q100 * nA], [codeA150, q150 * nA], [codeB100, q100 * nB], [codeB150, q150 * nB], [insA, total * nA], [insB, total * nB])
    raw.push([fam === 'MF' ? 'TAN055' : unitCode, fam === 'MF' ? (mfQty > 0 ? 1 : 0) : fam === 'LDY' || fam === 'USR' ? levels : 0])
    raw.push([usrInsT, usrInsT === '' ? 0 : (usrInsT === usrInsB ? 2 : 1) * levels])
    raw.push([usrInsB, usrInsB === '' || usrInsT === usrInsB ? 0 : levels])
    raw.push([fam === 'LDY' && c.calico ? look(`BAG|${wide}`) ?? '' : '', fam === 'LDY' && c.calico ? levels : 0])
    if (fam === 'MF') raw.push(['TAN056', c.mf100], ['TAN080', c.mf100], ['TAN057', c.mf200], ['TAN082', c.mf200], ['TAN058', c.mf300], ['TAN084', c.mf300])
    raw.push([slideCode, slideCode === '' ? 0 : fam === 'BSK' ? total * split : levels])
    for (const mm of ['11', '16', '18', '21', '25'] as const) raw.push([n(`n${mm}` as keyof typeof PCOL) > 0 ? look(`BAT|${depth}|${mm}`) ?? '' : '', n(`n${mm}` as keyof typeof PCOL)])
    raw.push(['TAN076', p ? Math.ceil((p[PCOL.spacers] * S.discsLayer * levels) / S.discsPack) : 0])
  }
  const codes: CodeLine[] = raw.filter(([code, qty]) => qty > 0 && code !== '' && code !== 'MISSING').map(([code, qty]) => ({ code, description: describeCode(code), qty }))

  return { fits, headline, pick: pickText, slides: slidesText, packersLeft: packers('L'), packersRight: packers('R'), weight: weightText, height: heightText, depthCheck: depthText, notes, compare, codes }
}
