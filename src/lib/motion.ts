// Scroll reveals with GSAP. Cards that start below the fold fade up as they scroll into view, a few at a time.
// Rules from DESIGN.md: only opacity and transform, the durations of the --dur tokens, and nothing at all for people who
// ask for reduced motion. Anything already on screen is never hidden, so the first screen never waits for this code, and
// GSAP itself loads only when there is something below the fold to animate.
import type { ScrollTrigger as ScrollTriggerType } from 'gsap/ScrollTrigger'

const DUR = 0.42 // --dur-long
const GAP = 0.06 // between cards that arrive together
const FAILSAFE_MS = 3000 // if the animation code cannot load, everything is shown anyway

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const stop = new Set<() => void>()

/** Use as a ref on a page's container: <div className="viz-stack" ref={reveal}>. Passing null (unmount) cleans up. */
export function reveal(el: HTMLElement | null): void {
  if (!el) { stop.forEach((s) => s()); stop.clear(); return }
  if (reduced()) return
  const below = [...el.querySelectorAll<HTMLElement>('.viz-card, .kpis > *')].filter((n) => n.getBoundingClientRect().top > window.innerHeight * 0.92)
  if (!below.length) return

  below.forEach((n) => n.classList.add('rv'))
  const show = () => below.forEach((n) => { n.classList.remove('rv'); n.style.removeProperty('opacity'); n.style.removeProperty('transform') })
  let gone = false
  let triggers: ScrollTriggerType[] = []
  const failsafe = window.setTimeout(show, FAILSAFE_MS)

  void (async () => {
    try {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
      if (gone) return
      gsap.registerPlugin(ScrollTrigger)
      gsap.set(below, { y: 14 })
      triggers = ScrollTrigger.batch(below, {
        start: 'top 92%',
        once: true,
        onEnter: (batch) => { gsap.to(batch, { opacity: 1, y: 0, duration: DUR, ease: 'power3.out', stagger: GAP, overwrite: true, clearProps: 'opacity,transform', onComplete: () => batch.forEach((n) => n.classList.remove('rv')) }) },
      })
    } catch { show() }
  })()

  stop.add(() => { gone = true; window.clearTimeout(failsafe); triggers.forEach((t) => t.kill()); show() })
}
