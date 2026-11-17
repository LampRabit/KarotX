import { useActivity } from '@/lib/activity'
import { useDelayed } from '@/lib/hooks'

/** Thin progress line along the top edge whenever any tracked operation runs. */
export function TopProgress() {
  const busy = useDelayed(useActivity().length > 0, 150)
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-300"
      style={{ opacity: busy ? 1 : 0 }}
    >
      <div className="h-full w-full origin-left animate-indeterminate bg-primary" />
    </div>
  )
}
