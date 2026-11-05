import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './Toast'
import './styles.css'

// Myriad Pro comes from an Adobe Fonts web project (kit). Set VITE_ADOBE_FONTS_KIT to its id to switch it on.
const kit = import.meta.env.VITE_ADOBE_FONTS_KIT as string | undefined
if (kit && /^[a-z0-9]+$/i.test(kit)) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://use.typekit.net/${kit}.css`
  document.head.appendChild(link)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)
