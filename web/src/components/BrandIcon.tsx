import { Database } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { DbKind } from '@/lib/databases'
import { cn } from '@/lib/cn'

/** Database logo on a softly tinted tile in its brand colour. */
export function BrandIcon({ db, size = 40, className }: { db: DbKind; size?: number; className?: string }) {
  const brand = db.icon ? `#${db.icon.hex}` : 'var(--muted-foreground)'
  const style = { '--brand': brand, width: size, height: size } as CSSProperties
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl text-[var(--brand)]',
        'bg-[color-mix(in_oklch,var(--brand)_12%,transparent)]',
        // Lift brand colours on dark backgrounds so they keep enough contrast.
        db.darkBrand
          ? 'dark:bg-foreground/10 dark:text-foreground'
          : 'dark:bg-[color-mix(in_oklch,var(--brand)_18%,transparent)] dark:text-[color-mix(in_oklch,var(--brand),white_45%)]',
        className,
      )}
    >
      {db.icon ? (
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
          <path d={db.icon.path} />
        </svg>
      ) : (
        <Database size={size * 0.5} />
      )}
    </span>
  )
}
