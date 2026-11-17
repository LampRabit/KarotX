import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'

/** Section that expands with a height animation. `badge` summarises its state when closed. */
export function Collapsible({ title, badge, defaultOpen = false, children }: { title: string; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="rounded-xl border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left font-medium transition hover:bg-muted/50"
      >
        <ChevronRight size={16} aria-hidden className={cn('text-muted-foreground transition-transform duration-200', open && 'rotate-90')} />
        {title}
        <span className="ml-auto">{badge}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t px-4 py-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
