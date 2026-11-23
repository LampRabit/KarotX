import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { GraphNode, GraphRel } from '@/lib/api'
import { caption, labelColor } from '@/lib/cypher'
import { Tooltip } from '../ui/Tooltip'

export type Selection = { kind: 'node' | 'rel'; id: string } | undefined

type P = { x: number; y: number; vx: number; vy: number; pinned?: boolean }
const R = 22

/**
 * Force-directed drawing of nodes and relationships (SVG). Drag nodes to move
 * them, drag the background to pan, scroll to zoom. Nodes are focusable:
 * Tab to move, Enter to select, double-click or Shift+Enter to expand.
 */
export function GraphCanvas({ nodes, rels, selected, pending, onSelect, onExpand }: {
  nodes: GraphNode[]; rels: GraphRel[]; selected: Selection
  /** Node waiting for a second click (creating a relationship). */
  pending?: string
  onSelect: (s: Selection) => void
  onExpand: (id: string) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const pos = useRef(new Map<string, P>())
  const alpha = useRef(1)
  const [, setFrame] = useState(0)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean }>(undefined)
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  // Place new nodes next to a neighbour that is already placed (or in a ring), then reheat.
  useEffect(() => {
    const m = pos.current
    const ids = new Set(nodes.map((n) => n.id))
    for (const id of [...m.keys()]) if (!ids.has(id)) m.delete(id)
    nodes.forEach((n, i) => {
      if (m.has(n.id)) return
      const nb = rels.find((r) => (r.start === n.id && m.has(r.end)) || (r.end === n.id && m.has(r.start)))
      const near = nb && m.get(nb.start === n.id ? nb.end : nb.start)
      const a = i * 2.4
      m.set(n.id, near
        ? { x: near.x + Math.cos(a) * 60, y: near.y + Math.sin(a) * 60, vx: 0, vy: 0 }
        : { x: Math.cos(a) * (40 + i * 6), y: Math.sin(a) * (40 + i * 6), vx: 0, vy: 0 })
    })
    alpha.current = 1
    if (reduced) {
      for (let i = 0; i < 300; i++) tick()
      setFrame((f) => f + 1)
    }
  }, [nodes, rels]) // eslint-disable-line react-hooks/exhaustive-deps

  function tick() {
    const m = pos.current
    const list = [...m.entries()]
    const a = alpha.current
    for (let i = 0; i < list.length; i++) {
      const [, p] = list[i]
      for (let j = i + 1; j < list.length; j++) {
        const [, q] = list[j]
        let dx = p.x - q.x, dy = p.y - q.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) (dx = Math.random() - 0.5, dy = Math.random() - 0.5, d2 = 1)
        const f = (2400 / d2) * a
        const d = Math.sqrt(d2)
        p.vx += (dx / d) * f; p.vy += (dy / d) * f
        q.vx -= (dx / d) * f; q.vy -= (dy / d) * f
      }
      p.vx -= p.x * 0.012 * a
      p.vy -= p.y * 0.012 * a
    }
    for (const r of rels) {
      const s = m.get(r.start), t = m.get(r.end)
      if (!s || !t || s === t) continue
      const dx = t.x - s.x, dy = t.y - s.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const f = (d - 120) * 0.04 * a
      s.vx += (dx / d) * f; s.vy += (dy / d) * f
      t.vx -= (dx / d) * f; t.vy -= (dy / d) * f
    }
    for (const [, p] of list) {
      if (p.pinned) { p.vx = p.vy = 0; continue }
      p.vx *= 0.6; p.vy *= 0.6
      p.x += Math.max(-30, Math.min(30, p.vx))
      p.y += Math.max(-30, Math.min(30, p.vy))
    }
    alpha.current = Math.max(0, a * 0.985 - 0.001)
  }

  // Animate while the layout is still moving.
  useEffect(() => {
    if (reduced) return
    let raf = 0
    const loop = () => {
      if (alpha.current > 0.02) {
        tick()
        setFrame((f) => f + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [rels, reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  function fit() {
    const ps = [...pos.current.values()]
    const el = svg.current
    if (!ps.length || !el) return
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y)
    const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 60, Math.max(...ys) + 60]
    const k = Math.min(2, el.clientWidth / (x1 - x0), el.clientHeight / (y1 - y0))
    setView({ k, x: el.clientWidth / 2 - ((x0 + x1) / 2) * k, y: el.clientHeight / 2 - ((y0 + y1) / 2) * k })
  }
  // Fit once the first layout has settled.
  const fitted = useRef(false)
  useEffect(() => {
    fitted.current = false
    const t = setTimeout(() => (fit(), (fitted.current = true)), reduced ? 0 : 900)
    return () => clearTimeout(t)
  }, [nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toWorld = (cx: number, cy: number) => {
    const b = svg.current!.getBoundingClientRect()
    return { x: (cx - b.left - view.x) / view.k, y: (cy - b.top - view.y) / view.k }
  }

  function onWheel(e: React.WheelEvent) {
    const b = svg.current!.getBoundingClientRect()
    const k = Math.max(0.15, Math.min(4, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    const mx = e.clientX - b.left, my = e.clientY - b.top
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k })
  }
  const zoom = (f: number) => {
    const el = svg.current!
    const k = Math.max(0.15, Math.min(4, view.k * f))
    const mx = el.clientWidth / 2, my = el.clientHeight / 2
    setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k })
  }

  function down(e: React.PointerEvent, id?: string) {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { id, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    if (id) pos.current.get(id)!.pinned = true
  }
  function move(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true
    if (d.id) {
      const p = pos.current.get(d.id)!
      const w = toWorld(e.clientX, e.clientY)
      p.x = w.x; p.y = w.y
      alpha.current = Math.max(alpha.current, 0.3)
      setFrame((f) => f + 1)
    } else {
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }))
    }
  }
  function up() {
    const d = drag.current
    drag.current = undefined
    if (!d) return
    if (d.id) {
      pos.current.get(d.id)!.pinned = d.moved // a moved node stays where it was dropped
      if (!d.moved) onSelect({ kind: 'node', id: d.id })
    } else if (!d.moved) onSelect(undefined)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  // Parallel relationships between the same two nodes are drawn as separate curves.
  const lanes = new Map<string, number>()
  const laneOf = (r: GraphRel) => {
    const key = [r.start, r.end].sort().join('|')
    const n = lanes.get(key) ?? 0
    lanes.set(key, n + 1)
    return n
  }

  return (
    <div className="relative h-full overflow-hidden bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]">
      <svg ref={svg} className="h-full w-full touch-none select-none" onWheel={onWheel} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}
        role="group" aria-label={`Graph with ${nodes.length} nodes and ${rels.length} relationships`}>
        <defs>
          <marker id="kx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-foreground)" />
          </marker>
          <marker id="kx-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--primary)" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {rels.map((r) => {
            const s = pos.current.get(r.start), t = pos.current.get(r.end)
            if (!s || !t) return null
            const on = selected?.kind === 'rel' && selected.id === r.id
            const lane = laneOf(r)
            let d: string, lx: number, ly: number
            if (s === t) {
              const o = 34 + lane * 12
              d = `M${s.x + R * 0.6},${s.y - R * 0.8} C${s.x + o * 2},${s.y - o * 2} ${s.x + o * 2},${s.y + o * 0.4} ${s.x + R},${s.y + R * 0.2}`
              lx = s.x + o * 1.6; ly = s.y - o * 0.8
            } else {
              const dx = t.x - s.x, dy = t.y - s.y
              const len = Math.max(1, Math.hypot(dx, dy))
              const ux = dx / len, uy = dy / len
              const bend = (lane % 2 ? -1 : 1) * Math.ceil(lane / 2) * 26 * (r.start < r.end ? 1 : -1)
              const mx = (s.x + t.x) / 2 - uy * bend, my = (s.y + t.y) / 2 + ux * bend
              d = `M${s.x + ux * R},${s.y + uy * R} Q${mx},${my} ${t.x - ux * (R + 2)},${t.y - uy * (R + 2)}`
              lx = (s.x + 2 * mx + t.x) / 4; ly = (s.y + 2 * my + t.y) / 4
            }
            return (
              <g key={r.id} className="cursor-pointer" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect({ kind: 'rel', id: r.id })}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                <path d={d} fill="none" stroke={on ? 'var(--primary)' : 'var(--muted-foreground)'} strokeOpacity={on ? 1 : 0.55} strokeWidth={on ? 2.2 : 1.4} markerEnd={`url(#${on ? 'kx-arrow-on' : 'kx-arrow'})`} />
                <text x={lx} y={ly} textAnchor="middle" dy="-3" fontSize={9.5} fill={on ? 'var(--primary)' : 'var(--muted-foreground)'} style={{ paintOrder: 'stroke' }} stroke="var(--background)" strokeWidth={3}>{r.type}</text>
              </g>
            )
          })}
          {nodes.map((n) => {
            const p = pos.current.get(n.id)
            if (!p) return null
            const on = selected?.kind === 'node' && selected.id === n.id
            const text = caption(n)
            const color = labelColor(n.labels[0])
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} tabIndex={0} role="button" className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-[var(--ring)]"
                aria-label={`${n.labels.join(', ') || 'Node'}: ${text}`} aria-pressed={on}
                onPointerDown={(e) => down(e, n.id)} onDoubleClick={() => onExpand(n.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), e.shiftKey ? onExpand(n.id) : onSelect({ kind: 'node', id: n.id }))
                }}>
                <circle r={R + 5} fill="none" stroke={on || pending === n.id ? 'var(--primary)' : 'transparent'} strokeWidth={2.5} strokeDasharray={pending === n.id ? '4 3' : undefined} />
                <circle r={R} fill={color} stroke="var(--background)" strokeWidth={2} />
                <text textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={600} fill="#fff" pointerEvents="none">{text.length > 7 ? text.slice(0, 6) + '…' : text}</text>
                {byId.size <= 150 && (
                  <text textAnchor="middle" y={R + 13} fontSize={10} fill="var(--foreground)" pointerEvents="none" style={{ paintOrder: 'stroke' }} stroke="var(--background)" strokeWidth={3}>
                    {text.length > 20 ? text.slice(0, 19) + '…' : text}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border bg-surface shadow-sm">
        {[
          { label: 'Zoom in', icon: <Plus size={14} />, run: () => zoom(1.25) },
          { label: 'Zoom out', icon: <Minus size={14} />, run: () => zoom(0.8) },
          { label: 'Fit to view', icon: <Maximize2 size={13} />, run: fit },
        ].map((b) => (
          <Tooltip key={b.label} content={b.label} side="left">
            <button aria-label={b.label} onClick={b.run} className="flex size-8 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground">{b.icon}</button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
