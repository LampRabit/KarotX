import { CircleCheck, ShieldAlert, ShieldCheck } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { Session } from '@/lib/api'
import { useActivity } from '@/lib/activity'
import { cn } from '@/lib/cn'
import { Spinner } from './ui/Spinner'
import { Tooltip } from './ui/Tooltip'

type Props = { session: Session; connections: number; onOpenSecurity: () => void }

/** Always-visible footer: server health, protection status and live background activity. */
export function StatusBar({ session, connections, onOpenSecurity }: Props) {
  const ops = useActivity()
  const latest = ops[ops.length - 1]

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t bg-sidebar px-2 text-xs text-muted-foreground">
      <Tooltip content="The KarotX server is running">
        <span className="flex items-center gap-1.5 px-1.5">
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-success" />
            <span className="relative size-2 rounded-full bg-success" />
          </span>
          Serving on {session.addr}
        </span>
      </Tooltip>

      <button
        onClick={onOpenSecurity}
        className={cn(
          'flex h-5 items-center gap-1 rounded px-1.5 transition hover:bg-muted',
          session.authRequired ? 'hover:text-foreground' : 'text-warning',
        )}
      >
        {session.authRequired ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
        {session.authRequired ? 'Password protected' : 'No password set'}
      </button>

      <div className="ml-auto flex items-center gap-3 px-1.5">
        <div aria-live="polite" className="flex items-center">
          <AnimatePresence mode="wait" initial={false}>
            {latest ? (
              <motion.span
                key="busy"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-1.5 text-foreground"
              >
                <Spinner size={12} className="text-primary" />
                {latest.label}
                {ops.length > 1 && <span className="text-muted-foreground">+{ops.length - 1} more</span>}
              </motion.span>
            ) : (
              <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
                <CircleCheck size={12} /> Ready
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <span>{connections} {connections === 1 ? 'connection' : 'connections'}</span>
        <span>{session.version === 'dev' ? 'dev build' : `v${session.version}`}</span>
      </div>
    </footer>
  )
}
