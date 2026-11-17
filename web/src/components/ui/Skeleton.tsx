import { cn } from '@/lib/cn'

/** Shimmering placeholder for content that is loading (lists, grids, trees). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'before:absolute before:inset-0 before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.06] before:to-transparent',
        className,
      )}
    />
  )
}
