import './karot.css'

export type Mode = 'system' | 'light' | 'dark'

/** Registered themes. `swatch` drives the preview in Settings → Appearance. */
export const themes = [
  { id: 'karot', name: 'Karot', swatch: { light: ['#fdfbf8', '#c2410c'], dark: ['#1c1917', '#fb923c'] } },
] as const

export const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches

export function applyTheme(theme: string, mode: Mode, animate = false) {
  const root = document.documentElement
  const run = () => {
    root.dataset.theme = themes.some((t) => t.id === theme) ? theme : themes[0].id
    const dark = mode === 'dark' || (mode === 'system' && prefersDark())
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
  }
  const vt = (document as Document & { startViewTransition?: (cb: () => void) => void }).startViewTransition
  if (animate && vt) vt.call(document, run)
  else run()
}
