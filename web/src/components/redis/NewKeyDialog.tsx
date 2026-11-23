import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Segmented } from '../ui/Segmented'
import type { RunCommand } from './RedisTab'

type KeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream'

const firstValue: Record<KeyType, string[]> = {
  string: ['Value'], hash: ['Field', 'Value'], list: ['Value'], set: ['Member'], zset: ['Member', 'Score'], stream: ['Field', 'Value'],
}

/** Create a key of any type with a first value, and an optional expiry. */
export function NewKeyDialog({ connId, db, open, onClose, run, onCreated, stringsOnly }: {
  connId: string; db: number; open: boolean; onClose: () => void; run: RunCommand; onCreated: (key: string) => void
  /** Memcached stores only strings. */
  stringsOnly?: boolean
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<KeyType>('string')
  const [vals, setVals] = useState<string[]>(['', ''])
  const [ttl, setTtl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) (setName(''), setType('string'), setVals(['', '']), setTtl(''), setError(''))
  }, [open])

  function command(): string[] {
    const [a, b] = vals
    switch (type) {
      case 'string': return ['SET', name, a]
      case 'hash': return ['HSET', name, a, b]
      case 'list': return ['RPUSH', name, a]
      case 'set': return ['SADD', name, a]
      case 'zset': return ['ZADD', name, b || '0', a]
      case 'stream': return ['XADD', name, '*', a, b]
    }
  }

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const exists = await api.redis.command(connId, db, { args: ['EXISTS', name] })
      if (exists.result === 1) return setError('A key with this name already exists. Pick another name, or edit that key instead.')
      if (await run(command(), 'Create key')) {
        if (Number(ttl) > 0) await run(['EXPIRE', name, ttl], 'Set expiry')
        onCreated(name)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="New key" className="max-w-lg">
      <form onSubmit={(e) => (e.preventDefault(), create())} className="space-y-4 p-6">
        <h2 className="text-[15px] font-semibold">New key</h2>
        <Input label="Key name" value={name} onChange={(e) => (setName(e.target.value), setError(''))} placeholder="e.g. user:42:profile" autoFocus required error={error} />
        {!stringsOnly && <div>
          <p className="mb-1.5 text-[13px] font-medium">Type</p>
          <Segmented label="Key type" value={type} onChange={setType} className="w-full"
            options={[{ value: 'string', label: 'String' }, { value: 'hash', label: 'Hash' }, { value: 'list', label: 'List' }, { value: 'set', label: 'Set' }, { value: 'zset', label: 'Sorted set' }, { value: 'stream', label: 'Stream' }]} />
        </div>}
        <div className="grid grid-cols-2 gap-3">
          {firstValue[type].map((f, i) => (
            <Input key={type + f} className={firstValue[type].length === 1 ? 'col-span-2' : undefined} label={i === 0 && type !== 'string' ? `First ${f.toLowerCase()}` : f}
              value={vals[i]} onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
        </div>
        <Input label="Expire after (seconds)" value={ttl} onChange={(e) => setTtl(e.target.value.replace(/\D/g, ''))} placeholder="Optional. Leave empty to keep forever" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>Create key</Button>
        </div>
      </form>
    </Dialog>
  )
}
