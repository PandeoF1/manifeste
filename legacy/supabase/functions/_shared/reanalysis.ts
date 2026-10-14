// Réanalyse des extractions non rattachées : on redonne à l'IA plus de contexte (titre et résumé
// de la page source) et la liste des lycées candidats, et elle choisit le bon (ou aucun).
import { z } from 'zod'
import { CERTAINTIES, meetsCertainty, type Certainty } from './extraction.ts'
export { extractPageContext, fetchPageContext } from './page.ts'

export interface Candidate {
  uai: string
  name: string
  city: string
  department: string | null
}

export interface ReanalysisItem {
  id: string
  school_name: string
  city: string | null
  status: string
  context: string
  candidates: Candidate[]
}

export const REANALYSIS_SYSTEM_PROMPT = `Tu aides à identifier des lycées français cités dans des articles ou messages sur des blocages.

Pour chaque fait, tu reçois : le nom de lycée et la commune extraits automatiquement (parfois incomplets ou faux), le titre et le résumé de la source, et une liste de lycées candidats (code UAI, nom, commune).
Choisis le lycée candidat concerné, en t'appuyant d'abord sur le texte de la source.
- uai : le code UAI d'un candidat de la liste, ou null si aucun ne correspond avec certitude.
- certainty : "haute" si le texte désigne clairement ce lycée (nom propre et commune concordants, ou commune n'ayant qu'un candidat plausible) ; "moyenne" si c'est probable ; "faible" sinon.
N'invente jamais de code : uniquement ceux de la liste.`

export const REANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    choices: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          uai: { type: 'STRING', nullable: true },
          certainty: { type: 'STRING', enum: [...CERTAINTIES] },
        },
        required: ['id', 'uai', 'certainty'],
        propertyOrdering: ['id', 'uai', 'certainty'],
      },
    },
  },
  required: ['choices'],
} as const

export function buildReanalysisPrompt(items: ReadonlyArray<ReanalysisItem>): string {
  const payload = items.map((i) => ({
    id: i.id,
    fait: { lycee: i.school_name, commune: i.city, statut: i.status },
    source: i.context || '(texte indisponible)',
    candidats: i.candidates.map((c) => ({
      uai: c.uai,
      nom: c.name,
      commune: c.city,
      departement: c.department,
    })),
  }))
  return `Faits à rattacher (JSON) :\n${JSON.stringify(payload)}`
}

const choiceSchema = z.object({
  id: z.string(),
  uai: z.string().nullable(),
  certainty: z.enum(CERTAINTIES),
})

/** Ne garde que les choix sûrs dont le code UAI figure bien parmi les candidats proposés. */
export function parseChoices(
  raw: unknown,
  items: ReadonlyArray<ReanalysisItem>,
  minCertainty: Certainty = 'moyenne',
): Map<string, string> {
  const out = new Map<string, string>()
  const list = z.object({ choices: z.array(z.unknown()) }).safeParse(raw)
  if (!list.success) return out
  const byId = new Map(items.map((i) => [i.id, i]))
  for (const candidate of list.data.choices) {
    const c = choiceSchema.safeParse(candidate)
    if (!c.success || !c.data.uai) continue
    const item = byId.get(c.data.id)
    if (!item || !meetsCertainty(c.data.certainty, minCertainty)) continue
    if (!item.candidates.some((k) => k.uai === c.data.uai)) continue
    out.set(item.id, c.data.uai)
  }
  return out
}
