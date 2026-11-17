import { RefreshCw, ServerCrash } from 'lucide-react'
import { motion } from 'motion/react'
import { useDelayed } from '@/lib/hooks'
import { Button } from './ui/Button'
import { Progress } from './ui/Progress'
import { LogoMark, Wordmark } from './Logo'

/** Startup screen: a loader while the workspace opens, or a clear error with retry. */
export function Boot({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const show = useDelayed(!error, 250) // don't flash a loader on fast starts
  if (!error && !show) return null

  return (
    <main className="flex h-full items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex w-full max-w-xs flex-col items-center gap-5 text-center"
      >
        {error ? (
          <>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <ServerCrash size={22} aria-hidden />
            </span>
            <div role="alert">
              <h1 className="text-lg font-semibold">Can't open KarotX</h1>
              <p className="mt-1 text-muted-foreground">{error}</p>
            </div>
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden /> Try again
            </Button>
          </>
        ) : (
          <>
            <motion.span animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
              <span className="flex flex-col items-center gap-1"><LogoMark size={64} /><Wordmark className="text-2xl" /></span>
            </motion.span>
            <div className="w-full space-y-3">
              <p className="text-muted-foreground">Opening your workspace…</p>
              <Progress label="Opening workspace" />
            </div>
          </>
        )}
      </motion.div>
    </main>
  )
}
