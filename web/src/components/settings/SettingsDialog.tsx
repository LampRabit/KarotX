import { Info, Palette, Shield } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { Mode } from '@/themes'
import type { Session } from '@/lib/api'
import { cn } from '@/lib/cn'
import { Dialog } from '../ui/Dialog'
import { Appearance } from './Appearance'
import { Security } from './Security'
import { About } from './About'

export type SettingsSection = 'appearance' | 'security' | 'about'

type Props = {
  open: boolean
  onOpenChange: (o: boolean) => void
  section: SettingsSection
  onSectionChange: (s: SettingsSection) => void
  session: Session
  theme: string
  mode: Mode
  onAppearance: (theme: string, mode: Mode) => void
  onSessionChanged: () => void
}

const nav = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'security', label: 'Security', Icon: Shield },
  { id: 'about', label: 'About', Icon: Info },
] as const

export function SettingsDialog(p: Props) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange} title="Settings" className="max-w-3xl">
      <div className="flex h-[min(560px,85vh)]">
        <nav aria-label="Settings sections" className="w-48 shrink-0 border-r bg-sidebar p-3">
          <h2 className="px-2 pt-1 pb-3 text-[15px] font-semibold">Settings</h2>
          <ul className="space-y-0.5">
            {nav.map(({ id, label, Icon }) => (
              <li key={id}>
                <button
                  onClick={() => p.onSectionChange(id)}
                  aria-current={p.section === id ? 'page' : undefined}
                  className={cn(
                    'relative flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] transition',
                    p.section === id ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {p.section === id && (
                    <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-lg bg-muted" transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }} />
                  )}
                  <Icon size={15} aria-hidden className="relative" />
                  <span className="relative">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex-1 overflow-y-auto p-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={p.section}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
            >
              {p.section === 'appearance' && <Appearance theme={p.theme} mode={p.mode} onChange={p.onAppearance} />}
              {p.section === 'security' && <Security session={p.session} onChanged={p.onSessionChanged} />}
              {p.section === 'about' && <About session={p.session} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Dialog>
  )
}

