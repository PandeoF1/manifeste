// Edge Function : réanalyse par l'IA des extractions non rattachées (bouton de l'admin).
// Pour chaque extraction : lycées candidats (commune + noms proches), titre et résumé de la page
// source, puis UN appel Gemini pour toutes, qui choisit le lycée ou aucun.
// Les choix sûrs deviennent des signaux, soumis à la règle de validation habituelle.
import { mapLimit } from '../_shared/collector.ts'
import { extractDomain } from '../_shared/domain.ts'
import { createGeminiClient, modelsFromEnv } from '../_shared/gemini.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import {
  REANALYSIS_SCHEMA,
  REANALYSIS_SYSTEM_PROMPT,
  buildReanalysisPrompt,
  fetchPageContext,
  parseChoices,
  type Candidate,
  type ReanalysisItem,
} from '../_shared/reanalysis.ts'
import { admin, isAuthorized } from '../_shared/service.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODELS = modelsFromEnv(
  Deno.env.get('GEMINI_MODEL'),
  Deno.env.get('GEMINI_FALLBACK_MODELS'),
)
const MAX_ITEMS = 40

interface UnmatchedRow {
  id: string
  source_id: string | null
  source_domain: string | null
  school_name: string
  city: string | null
  status: 'bloque' | 'filtrant' | 'leve'
  source_url: string
  observed_at: string
}

type Outcome = {
  id: string
  school_name: string
  city: string | null
  result: string
  uai?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await isAuthorized(req))) return json(401, { error: 'unauthorized' })
  if (!GEMINI_API_KEY) return json(500, { error: 'missing_gemini_api_key' })

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string')
    : null

  let query = admin
    .from('unmatched_extractions')
    .select('id, source_id, source_domain, school_name, city, status, source_url, observed_at')
    .order('created_at', { ascending: false })
    .limit(MAX_ITEMS)
  if (ids) query = query.in('id', ids.slice(0, MAX_ITEMS))
  const { data, error } = await query
  if (error) return json(500, { error: error.message })
  const rows = (data ?? []) as UnmatchedRow[]
  const outcomes: Outcome[] = []

  // Candidats et contexte, en parallèle (I/O).
  const prepared = await mapLimit(rows, 6, async (row) => {
    const [{ data: candidates }, context] = await Promise.all([
      admin.rpc('unmatched_candidates', { p_unmatched_id: row.id }),
      fetchPageContext(fetch, row.source_url),
    ])
    return {
      row,
      item: { ...row, context, candidates: (candidates ?? []) as Candidate[] } as ReanalysisItem,
    }
  })

  const askable = prepared.filter((p) => p.item.candidates.length > 0)
  for (const p of prepared) {
    if (p.item.candidates.length === 0) {
      outcomes.push({
        id: p.row.id,
        school_name: p.row.school_name,
        city: p.row.city,
        result: 'Aucun lycée candidat (commune inconnue du référentiel ?)',
      })
    }
  }

  let model: string | null = null
  if (askable.length > 0) {
    const client = createGeminiClient({
      apiKey: GEMINI_API_KEY,
      models: GEMINI_MODELS,
      fetchFn: fetch,
    })
    let choices: Map<string, string>
    try {
      const raw = await client.generate({
        system: REANALYSIS_SYSTEM_PROMPT,
        user: buildReanalysisPrompt(askable.map((p) => p.item)),
        schema: REANALYSIS_SCHEMA,
      })
      choices = parseChoices(
        raw,
        askable.map((p) => p.item),
      )
      model = [...client.served][0] ?? null
    } catch (e) {
      return json(502, { error: e instanceof Error ? e.message : 'Gemini indisponible' })
    }

    for (const { row, item } of askable) {
      const uai = choices.get(row.id)
      if (!uai) {
        outcomes.push({
          id: row.id,
          school_name: row.school_name,
          city: row.city,
          result: "L'IA n'a pas trouvé avec certitude",
        })
        continue
      }
      const sourceType = row.source_id
        ? ((
            await admin
              .from('scrape_sources')
              .select('source_type')
              .eq('id', row.source_id)
              .maybeSingle()
          ).data?.source_type ?? 'collecteur')
        : 'collecteur'
      const { error: insertError } = await admin.from('reports').insert({
        school_uai: uai,
        status: row.status,
        source_type: sourceType,
        source_url: row.source_url,
        source_domain: row.source_domain ?? extractDomain(row.source_url),
        source_id: row.source_id,
        certainty: 'moyenne',
        observed_at: row.observed_at,
      })
      if (insertError && insertError.code !== '23505') {
        outcomes.push({
          id: row.id,
          school_name: row.school_name,
          city: row.city,
          result: `Erreur : ${insertError.message}`,
        })
        continue
      }
      await admin.from('unmatched_extractions').delete().eq('id', row.id)
      const chosen = item.candidates.find((c) => c.uai === uai)
      outcomes.push({
        id: row.id,
        school_name: row.school_name,
        city: row.city,
        uai,
        result: `Rattaché à ${chosen?.name ?? uai} (${chosen?.city ?? ''})`,
      })
    }
  }

  return json(200, {
    model,
    linked: outcomes.filter((o) => o.uai).length,
    total: rows.length,
    outcomes,
  })
})
