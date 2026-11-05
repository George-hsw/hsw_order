// A short beep for a good scan, a lower double tone for a miss. Web Audio, so no sound files to load.
let ctx: AudioContext | undefined

function audio(): AudioContext | undefined {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return undefined
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return undefined }
}

/** Call from a tap or click (opening the scanner) so the browser allows sound later. iOS needs this. */
export function primeAudio() { audio() }

export function beep(kind: 'ok' | 'miss' = 'ok') {
  const a = audio()
  if (!a) return
  const tones: [number, number, number][] = kind === 'ok' ? [[1318, 0, 0.1]] : [[330, 0, 0.12], [247, 0.15, 0.18]]
  for (const [freq, delay, length] of tones) {
    const osc = a.createOscillator()
    const gain = a.createGain()
    const t = a.currentTime + delay
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    osc.connect(gain).connect(a.destination)
    osc.start(t)
    osc.stop(t + length + 0.02)
  }
}
