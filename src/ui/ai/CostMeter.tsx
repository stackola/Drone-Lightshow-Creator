// A visible, itemised AI cost meter: what this window has spent, today, and
// in all, with every call listed (what it was for, model, tokens, cost).

import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleDollarSign } from 'lucide-react'
import { claudePrice, formatUsd, imagePrice, spentSince, startOfToday, useCosts } from '@/ai/costs'
import { MODEL } from '@/ai/client'
import { loadImageSettings } from '@/ai/openai'

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const k = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function CostMeter({ since, busy, label = 'this window' }: { since: number; busy?: boolean; label?: string }) {
  const entries = useCosts((s) => s.entries)
  const total = useCosts((s) => s.total)
  const running = useCosts((s) => s.running)
  const [open, setOpen] = useState(false)
  const here = entries.filter((e) => e.at >= since)
  const spent = spentSince(entries, since)
  const today = spentSince(entries, startOfToday())
  const claude = here.filter((e) => e.service === 'claude').reduce((a, e) => a + e.usd, 0)
  const images = here.filter((e) => e.service === 'openai').reduce((a, e) => a + e.usd, 0)
  const cp = claudePrice(MODEL), img = loadImageSettings(), ip = imagePrice(img.model)
  return (
    <div className={`cost-meter${busy || running ? ' busy' : ''}`} aria-label="AI cost">
      <button className="cost-head" onClick={() => setOpen(!open)} aria-expanded={open} title="What the AI calls cost (estimated from list prices)">
        <CircleDollarSign size={15} />
        <span className="cost-main">{formatUsd(spent)}</span>
        <span className="cost-sub">{label}</span>
        <span className="cost-split">Claude {formatUsd(claude)} · pictures {formatUsd(images)}</span>
        <span className="cost-sub" style={{ marginLeft: 'auto' }}>today {formatUsd(today)} · all {formatUsd(total)}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="cost-body">
          {here.length ? (
            <table className="cost-table">
              <thead><tr><th>Time</th><th>For</th><th>Model</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
              <tbody>
                {[...here].reverse().map((e) => (
                  <tr key={e.id}>
                    <td>{time(e.at)}</td>
                    <td>{e.label}</td>
                    <td className="cost-model">{e.model}</td>
                    <td>{k(e.input + (e.cacheRead ?? 0) + (e.cacheWrite ?? 0) + (e.imageInput ?? 0))} / {k(e.output)}{e.cacheRead ? <span className="hint"> ({k(e.cacheRead)} cached)</span> : null}</td>
                    <td className="cost-usd">{formatUsd(e.usd, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint" style={{ margin: 0 }}>Nothing spent here yet.</p>}
          <p className="hint" style={{ margin: '6px 0 0' }}>
            Estimated from list prices per million tokens — Claude ({MODEL}): ${cp.input} in, ${cp.output} out, ${cp.cacheRead} cached; pictures ({img.model}, {img.quality}): ${ip.output} per million image tokens (about {formatUsd((1756 * ip.output) / 1e6)} for a square medium picture). Your provider bills are the source of truth; prices can be changed in AI settings.
          </p>
        </div>
      )}
    </div>
  )
}
