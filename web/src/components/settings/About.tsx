import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Session } from '@/lib/api'
import { LogoMark, Wordmark } from '../Logo'
import { SectionHeader } from './SectionHeader'

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-4 py-3">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono text-[13px]" title={value}>{value}</dd>
      {copy && (
        <button
          onClick={() => navigator.clipboard.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
        </button>
      )}
    </div>
  )
}

export function About({ session }: { session: Session }) {
  return (
    <div>
      <SectionHeader title="About" text="Details about this KarotX instance." />
      <div className="mb-6 flex items-center gap-3">
        <LogoMark size={52} />
        <div>
          <Wordmark className="text-2xl" />
          <div className="text-[13px] text-muted-foreground">by LampRabit</div>
        </div>
      </div>
      <dl className="divide-y border-y">
        <Row label="Version" value={session.version} />
        <Row label="Listening on" value={session.addr} />
        <Row label="Workspace file" value={session.statePath} copy />
      </dl>
    </div>
  )
}
