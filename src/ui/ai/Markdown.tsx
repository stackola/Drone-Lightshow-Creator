import type { ReactNode } from 'react'

// A small, safe Markdown renderer for model output: builds React elements
// (never raw HTML). Supports headings, lists, paragraphs, **bold**, *italic*, `code`.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>)
    else out.push(<em key={`${key}-${i++}`}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(' '), `p${blocks.length}`)}</p>)
    para = []
  }
  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, k) => <li key={k}>{inline(it, `l${blocks.length}-${k}`)}</li>)
    blocks.push(list.ordered ? <ol key={`o${blocks.length}`}>{items}</ol> : <ul key={`u${blocks.length}`}>{items}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) {
      flushPara(); flushList()
      const level = h[1]!.length
      const content = inline(h[2]!, `h${blocks.length}`)
      blocks.push(level === 1 ? <h1 key={`h${blocks.length}`}>{content}</h1> : level === 2 ? <h2 key={`h${blocks.length}`}>{content}</h2> : <h3 key={`h${blocks.length}`}>{content}</h3>)
    } else if (ul || ol) {
      flushPara()
      const ordered = !!ol
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((ul ?? ol)![1]!)
    } else if (!line.trim()) {
      flushPara(); flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara(); flushList()
  return <div className="md">{blocks}</div>
}
