import { useEffect, useRef, useState } from 'react'
import { useToast } from './Toast'

interface Props {
  onScan: (value: string) => void // return after each successful read; scanner stays open
  onClose: () => void
  feedback: string // last result message shown over the video
}

type BarcodeDetectorLike = { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> }
declare global {
  interface Window {
    BarcodeDetector?: new (o?: { formats: string[] }) => BarcodeDetectorLike
  }
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']

/** Full-screen camera scanner. Native BarcodeDetector where available (Chrome/Android), ZXing elsewhere (iOS Safari). */
export default function Scanner({ onScan, onClose, feedback }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const toast = useToast()
  const [error, setError] = useState('')
  const [live, setLive] = useState(false) // the camera is showing
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | undefined
    let stopZxing: (() => void) | undefined
    let last = ''
    let lastAt = 0

    const emit = (v: string) => {
      const now = Date.now()
      if (v === last && now - lastAt < 2500) return // debounce the same code held in view
      last = v
      lastAt = now
      navigator.vibrate?.(60)
      onScanRef.current(v)
    }

    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera not available (the page must be opened over HTTPS).')
        const video = videoRef.current!
        if (window.BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
          if (stopped) return stream.getTracks().forEach((t) => t.stop())
          video.srcObject = stream
          await video.play()
          const det = new window.BarcodeDetector({ formats: FORMATS })
          const tick = async () => {
            if (stopped) return
            try {
              const found = await det.detect(video)
              if (found[0]?.rawValue) emit(found[0].rawValue)
            } catch { /* frame not ready */ }
            setTimeout(tick, 120)
          }
          tick()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromVideoDevice(undefined, video, (res) => {
            if (res) emit(res.getText())
          })
          stopZxing = () => controls.stop()
          if (stopped) stopZxing()
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast.error(`Camera problem: ${msg}`)
      }
    })()

    return () => {
      stopped = true
      stopZxing?.()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="scanner" role="dialog" aria-label="Barcode scanner">
      <video ref={videoRef} playsInline muted onPlaying={() => setLive(true)} />
      <button type="button" className="scan-x" aria-label="Close the scanner" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      <div className="reticle" />
      <div className="scan-msg">{error ? <span className="bad">{error}</span> : feedback || (live ? 'Point the camera at a barcode' : 'Starting the camera…')}</div>
      <button type="button" className="btn primary scan-close" onClick={onClose}>Done</button>
    </div>
  )
}
