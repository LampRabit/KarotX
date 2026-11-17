import './karot.css'

export type Mode = 'system' | 'light' | 'dark'

export const themes = [{ id: 'karot', name: 'Karot' }] as const

export function applyTheme(theme: string, mode: Mode) {
  const root = document.documentElement
  const known = themes.some((t) => t.id === theme)
  root.dataset.theme = known ? theme : themes[0].id
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}
