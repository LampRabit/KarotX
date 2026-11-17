import { useId } from 'react'
import { cn } from '@/lib/cn'

/** The KarotX carrot mark, cropped from public/KarotX-logo.svg. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const g = (n: number) => `url(#${id}g${n})`
  const stroke = { stroke: '#16243a', strokeWidth: 4.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="62 335 290 290" width={size} height={size} aria-hidden className={cn('shrink-0', className)}>
      <defs>
        {[
          [166.453, 366.393, 154.589, 524.652],
          [131.642, 442.948, 111.975, 565.903],
          [111.364, 509.657, 96.706, 606.696],
          [108.711, 577.424, 121.455, 663.924],
        ].map(([x1, y1, x2, y2], i) => (
          <linearGradient key={i} id={`${id}g${i + 1}`} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ff8053" />
            <stop offset="1" stopColor="#f2673a" />
          </linearGradient>
        ))}
        <linearGradient id={`${id}g5`} x1="254.743" y1="342.598" x2="280.545" y2="440.044" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#82b67a" />
          <stop offset="1" stopColor="#6ea36b" />
        </linearGradient>
      </defs>
      <path {...stroke} fill={g(1)} d="M180.064 390.664 C146.759 391.495 129.174 425.111 132.065 435.898 C153.778 486.731 224.901 527.793 279.78 521.181 C290.567 518.291 310.887 486.255 294.954 456.996 C274.34 423.21 219.63 391.624 180.064 390.664 Z" />
      <path {...stroke} fill={g(2)} d="M131.642 442.948 C151.988 492.991 225.845 535.633 280.725 529.021 C261.251 546.957 244.725 562.946 233.727 569.362 C188.266 572.294 133.557 540.707 113.366 499.871 C114.79 487.928 122.532 465.043 131.642 442.948 Z" />
      <path {...stroke} fill={g(3)} d="M111.364 509.657 C128.819 548.913 183.528 580.5 226.253 575.989 C206.992 590.399 190.099 600.706 177.733 606.332 C151.477 607.586 121.387 590.214 109.346 566.849 C108.035 553.326 108.515 533.543 111.364 509.657 Z" />
      <path {...stroke} fill={g(4)} d="M108.711 577.424 C115.281 597.631 148.107 616.582 168.891 612.169 C146.683 628.526 123.106 644.092 106.425 650.874 C103.958 633.037 105.651 604.836 108.711 577.424 Z" />
      <path {...stroke} fill="none" d="M180.064 390.664 C195.151 434.024 249.86 465.61 294.954 456.996" />
      <path {...stroke} strokeWidth={5} fill={g(5)} d="M232.095 407.939 C232.265 369.74 246.056 352.171 266.05 349.126 C266.515 376.749 257.617 395.319 244.616 411.52 M246.562 414.467 C269.039 381.853 296.873 377.864 308.76 392.021 C296.125 413.905 271.604 421.631 252.399 423.309" />
    </svg>
  )
}

/** "KarotX" wordmark as live text so it follows the theme (navy in light, white in dark). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-extrabold tracking-[-0.03em]', className)}>
      Karot<span className="text-brand">X</span>
    </span>
  )
}

/** Mark + wordmark lockup. */
export function Logo({ size = 28, wordmark = false, className }: { size?: number; wordmark?: boolean; className?: string }) {
  if (!wordmark) return <LogoMark size={size} className={className} />
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <LogoMark size={size} />
      <Wordmark className="leading-none" />
    </span>
  )
}
