/**
 * One shared tooltip for every element with a data-tip. It is fixed to the window and kept inside it, so a table's scroll area, a card
 * or a narrow phone never cuts the words off, whatever the text size or zoom. It shows on hover and keyboard focus (a tap focuses too).
 */
export function installTooltips(): void {
  if (typeof document === 'undefined') return
  const tip = document.createElement('div')
  tip.className = 'tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  document.body.append(tip)

  let owner: HTMLElement | null = null
  const GAP = 8

  const hide = () => { owner = null; tip.hidden = true }

  const place = () => {
    if (!owner) return
    const at = owner.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    tip.style.left = '0px'; tip.style.top = '0px'
    const w = tip.offsetWidth, h = tip.offsetHeight
    const left = Math.min(Math.max(GAP, at.left), Math.max(GAP, vw - w - GAP))
    const below = at.bottom + GAP
    const top = below + h + GAP <= vh || at.top - h - GAP < GAP ? below : at.top - h - GAP
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
  }

  const show = (el: HTMLElement) => {
    const text = el.getAttribute('data-tip')
    if (!text) return hide()
    owner = el
    tip.textContent = text
    tip.hidden = false
    place()
  }

  const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null)
  document.addEventListener('mouseover', (e) => { const el = target(e); if (el) show(el) })
  document.addEventListener('mouseout', (e) => { const el = target(e); if (el && el === owner && !el.matches(':focus')) hide() })
  document.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el) })
  document.addEventListener('focusout', (e) => { if (target(e) === owner) hide() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide() })
  window.addEventListener('scroll', hide, { capture: true, passive: true })
  window.addEventListener('resize', hide)
}
