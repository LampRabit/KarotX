import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { themes, type Mode } from '@/themes'
import { cn } from '@/lib/cn'
import { SectionHeader } from './SectionHeader'

const modes = [
  { id: 'system', label: 'System', Icon: Monitor, hint: 'Follows your OS' },
  { id: 'light', label: 'Light', Icon: Sun, hint: 'Always light' },
  { id: 'dark', label: 'Dark', Icon: Moon, hint: 'Always dark' },
] as const

/** Miniature app window used to preview a colour pair. */
function Preview({ bg, accent }: { bg: string; accent: string }) {
  const line = 'color-mix(in oklch, currentColor 18%, transparent)'
  return (
    <span className="flex h-full flex-1 gap-1.5 p-2" style={{ background: bg, color: bg === '#111a2a' ? '#fff' : '#16243a' }}>
      <span className="w-1/4 space-y-1 rounded-sm p-1" style={{ background: line }}>
        <span className="block h-1.5 rounded-full" style={{ background: accent }} />
      </span>
      <span className="flex-1 space-y-1 pt-1">
        <span className="block h-1.5 w-3/4 rounded-full" style={{ background: line }} />
        <span className="block h-1.5 w-1/2 rounded-full" style={{ background: line }} />
      </span>
    </span>
  )
}

type Props = { theme: string; mode: Mode; onChange: (theme: string, mode: Mode) => void }

export function Appearance({ theme, mode, onChange }: Props) {
  return (
    <div className="space-y-8">
      <SectionHeader title="Appearance" text="Choose how KarotX looks. Changes are saved to your workspace." />

      <fieldset>
        <legend className="mb-3 text-[13px] font-semibold">Color mode</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-3">
          {modes.map(({ id, label, Icon, hint }) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              onClick={() => onChange(theme, id)}
              className={cn(
                'flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition',
                mode === id ? 'border-primary ring-3 ring-primary/15' : 'hover:border-foreground/25',
              )}
            >
              <Icon size={18} aria-hidden className={mode === id ? 'text-primary' : 'text-muted-foreground'} />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-[13px] text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold">Theme</legend>
        <p className="mb-3 text-[13px] text-muted-foreground">Every theme comes in a light and a dark version. More themes are on the way.</p>
        <div role="radiogroup" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {themes.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={theme === t.id}
              onClick={() => onChange(t.id, mode)}
              className={cn(
                'overflow-hidden rounded-xl border text-left transition',
                theme === t.id ? 'border-primary ring-3 ring-primary/15' : 'hover:border-foreground/25',
              )}
            >
              <span className="flex h-20 border-b">
                <Preview bg={t.swatch.light[0]} accent={t.swatch.light[1]} />
                <Preview bg={t.swatch.dark[0]} accent={t.swatch.dark[1]} />
              </span>
              <span className="flex items-center justify-between px-3 py-2 font-medium">
                {t.name}
                {theme === t.id && <Check size={15} className="text-primary" aria-hidden />}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
