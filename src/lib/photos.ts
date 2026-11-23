import type { Photo } from './quote'

/** The longest side a kept photo has: big enough to read on a printed page, small enough to save and email. */
export const PHOTO_MAX = 1280

/** The size a photo is shrunk to: its longest side becomes `max`, its shape stays the same. Never makes it bigger. */
export function fitWithin(w: number, h: number, max = PHOTO_MAX): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/** Reads a photo the person chose (or took), turns it the right way up, shrinks it and keeps it as a JPEG data URL. */
export async function shrinkPhoto(file: File): Promise<Photo> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { w, h } = fitWithin(bmp.width, bmp.height)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No canvas')
    ctx.fillStyle = '#fff' // a PNG with see-through parts must not turn black as a JPEG
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    return { name: file.name.slice(0, 80), data: canvas.toDataURL('image/jpeg', 0.75), w, h }
  } finally { bmp.close() }
}
