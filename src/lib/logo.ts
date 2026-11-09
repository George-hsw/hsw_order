/** The HSW logo as a data URL for the PDF (loaded once from public/logo.png). */
export interface Logo { data: string; width: number; height: number }

let cached: Promise<Logo | null> | undefined

export function loadLogo(): Promise<Logo | null> {
  cached ??= (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}logo.png`)
      if (!res.ok) return null
      const blob = await res.blob()
      const data = await new Promise<string>((ok, no) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result))
        r.onerror = () => no(r.error)
        r.readAsDataURL(blob)
      })
      const dims = await new Promise<{ w: number; h: number }>((ok, no) => {
        const img = new Image()
        img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => no(new Error('logo'))
        img.src = data
      })
      return { data, width: dims.w, height: dims.h }
    } catch {
      return null
    }
  })()
  return cached
}
