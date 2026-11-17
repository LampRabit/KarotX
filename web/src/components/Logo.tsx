import { Database } from 'lucide-react'

/** Placeholder mark until the final KarotX logo is ready. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Database size={size * 0.58} strokeWidth={2.25} />
    </span>
  )
}
