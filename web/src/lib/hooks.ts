import { useEffect, useState } from 'react'

/** True only after `active` has stayed true for `delay` ms — avoids loader flashes on fast operations. */
export function useDelayed(active: boolean, delay = 200) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) return setShown(false)
    const t = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(t)
  }, [active, delay])
  return shown
}

/** Run `handler` on a keyboard shortcut like "mod+," (mod = Ctrl, or ⌘ on macOS). */
export function useHotkey(combo: string, handler: () => void) {
  useEffect(() => {
    const [mod, key] = combo.split('+')
    const onKey = (e: KeyboardEvent) => {
      if (mod === 'mod' && (e.ctrlKey || e.metaKey) && e.key === key) {
        e.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, handler])
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
