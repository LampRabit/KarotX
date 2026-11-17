import { Database } from 'lucide-react'

/** Placeholder mark until the final KarotX logo is ready. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center rounded-[28%] bg-gradient-to-br from-[oklch(0.74_0.17_58)] to-[oklch(0.56_0.2_36)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.25),0_2px_8px_oklch(0.6_0.18_45/0.35)]"
      style={{ width: size, height: size }}
    >
      <Database size={size * 0.56} strokeWidth={2.25} />
    </span>
  )
}
