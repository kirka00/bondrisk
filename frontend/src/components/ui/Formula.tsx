import katex from 'katex'
import { useMemo } from 'react'
import { formulas, substitution, type FormulaKey } from '../../lib/formulas'

export function Tex({ tex, display = true }: { tex: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false }), [tex, display])
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

export function FormulaBlock({ k, values }: { k: FormulaKey; values?: Record<string, number | string | null | undefined> }) {
  const f = formulas[k]
  const sub = values ? substitution(k, values) : null
  return (
    <div>
      <h4 className="text-[13px] mb-1.5">{f.title}</h4>
      <Tex tex={f.tex} />
      {'note' in f && f.note && <p className="text-text-2 text-xs">{f.note}</p>}
      {sub && <p className="font-mono text-xs text-text-2 mt-1">{sub}</p>}
    </div>
  )
}
