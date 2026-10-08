import { CircleDashed, ShieldCheck } from 'lucide-react'
import { sourceConfidence } from '@/lib/confidence'

/** Badge « Confirmé par N sources » ou « Source unique » (forme + texte, jamais la couleur seule). */
export function SourceConfidence({ count }: { count: number }) {
  const c = sourceConfidence(count)
  if (c.level === 'inconnu') return null
  const Icon = c.level === 'confirme' ? ShieldCheck : CircleDashed
  return (
    <span
      title={c.detail}
      className={`inline-flex items-center gap-1 text-sm ${c.level === 'confirme' ? 'font-semibold text-good' : 'text-muted'}`}
    >
      <Icon size={14} aria-hidden="true" />
      {c.label}
    </span>
  )
}

/** Version compacte pour les lignes de liste. */
export function SourceConfidenceInline({ count }: { count: number }) {
  const c = sourceConfidence(count)
  if (c.level === 'inconnu') return null
  const Icon = c.level === 'confirme' ? ShieldCheck : CircleDashed
  return (
    <span
      title={c.detail}
      className={`flex items-center justify-end gap-1 ${c.level === 'confirme' ? 'text-good' : 'text-muted'}`}
    >
      <Icon size={12} aria-hidden="true" />
      {c.level === 'confirme' ? `${count} sources` : '1 source'}
    </span>
  )
}
