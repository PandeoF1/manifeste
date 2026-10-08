// Edge Function : réanalyse par l'IA des extractions non rattachées (bouton de l'admin).
// 1. Contexte : extrait conservé + titre et chapeau de la page source (l'URL réelle est
//    retrouvée derrière les liens Google Actualités).
// 2. Si la commune manque ou si le nom est générique : nouvelle extraction sur ce contexte.
// 3. Lycées candidats (commune + noms proches), puis l'IA choisit le bon ou aucun.
// Deux appels Gemini au plus pour toute la liste. Les choix sûrs deviennent des signaux,
// soumis à la règle de validation habituelle.
import { mapLimit } from '../_shared/collector-utils.ts'
import { extractDomain } from '../_shared/domain.ts'
import { parseExtraction } from '../_shared/extraction.ts'
import { isGoogleNewsUrl, resolveGoogleNewsUrls } from '../_shared/fetchers/googlenews.ts'
import {
  createGeminiClient,
  extractionRequest,
  modelsFromEnv,
  thinkingBudgetFromEnv,
  totalUsage,
} from '../_shared/gemini.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { isGenericSchoolName } from '../_shared/matching.ts'
import { fetchPageContext } from '../_shared/page.ts'
import {
  REANALYSIS_SCHEMA,
  REANALYSIS_SYSTEM_PROMPT,
  buildReanalysisPrompt,
  parseChoices,
  type Candidate,
  type ReanalysisItem,
} from '../_shared/reanalysis.ts'
import { admin, isAuthorized } from '../_shared/service.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Action manuelle et rare : on peut se permettre un modèle plus fin que pour la collecte.
const MODELS = modelsFromEnv(
  Deno.env.get('REANALYZE_MODEL') || 'gemini-3.6-flash',
  Deno.env.get('REANALYZE_FALLBACK_MODELS') ?? 'gemini-3.5-flash,gemini-3.5-flash-lite',
)
const MAX_ITEMS = 40
/** Réflexion coupée par défaut (REANALYZE_THINKING_BUDGET ; -1 : réglage du modèle). */
const THINKING_BUDGET = thinkingBudgetFromEnv(Deno.env.get('REANALYZE_THINKING_BUDGET'), 0)

interface UnmatchedRow {
  id: string
  source_id: string | null
  source_domain: string | null
  context: string | null
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

function mergeText(...parts: Array<string | null | undefined>): string {
  const lines = parts
    .flatMap((p) => (p ?? '').split('\n'))
    .map((l) => l.trim())
    .filter(Boolean)
  return [...new Set(lines)].join('\n').slice(0, 1000)
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
    .select(
      'id, source_id, source_domain, context, school_name, city, status, source_url, observed_at',
    )
    .order('created_at', { ascending: false })
    .limit(MAX_ITEMS)
  if (ids) query = query.in('id', ids.slice(0, MAX_ITEMS))
  const { data, error } = await query
  if (error) return json(500, { error: error.message })
  const rows = (data ?? []) as UnmatchedRow[]
  const client = createGeminiClient({
    apiKey: GEMINI_API_KEY,
    models: MODELS,
    thinkingBudget: THINKING_BUDGET,
    fetchFn: fetch,
  })
  const outcomes: Outcome[] = []

  try {
    // 1. Contexte, avec l'URL réelle des articles Google Actualités.
    const resolved = await resolveGoogleNewsUrls(
      fetch,
      rows.map((r) => r.source_url).filter(isGoogleNewsUrl),
    )
    await mapLimit(rows, 6, async (row) => {
      const realUrl = resolved.get(row.source_url)
      if (realUrl) {
        row.source_url = realUrl
        row.source_domain = row.source_domain ?? extractDomain(realUrl)
      }
      const page = isGoogleNewsUrl(row.source_url)
        ? ''
        : await fetchPageContext(fetch, row.source_url)
      row.context = mergeText(row.context, page) || null
    })

    // 2. Nouvelle extraction quand la commune manque ou que le nom est générique.
    const vague = rows.filter(
      (r) => r.context && (!r.city || isGenericSchoolName(r.school_name, r.city)),
    )
    if (vague.length > 0) {
      const batch = vague.map((r) => ({
        id: r.id,
        item: {
          externalId: r.id,
          url: r.source_url,
          text: r.context ?? '',
          publishedAt: new Date(r.observed_at),
        },
      }))
      const events = parseExtraction(
        await client.generate(extractionRequest(batch)),
        new Set(vague.map((r) => r.id)),
      )
      for (const row of vague) {
        const better = events.find((e) => e.item_id === row.id && e.city)
        if (better) {
          row.school_name = better.school_name
          row.city = better.city
        }
      }
    }

    // Enregistre les corrections (nom, commune, URL réelle, extrait) avant de chercher les candidats.
    await mapLimit(rows, 6, async (row) => {
      await admin
        .from('unmatched_extractions')
        .update({
          school_name: row.school_name,
          city: row.city,
          source_url: row.source_url,
          source_domain: row.source_domain,
          context: row.context,
        })
        .eq('id', row.id)
    })

    // 3. Candidats puis choix par l'IA.
    const prepared = await mapLimit(rows, 6, async (row) => {
      const { data: candidates } = await admin.rpc('unmatched_candidates', {
        p_unmatched_id: row.id,
      })
      const item: ReanalysisItem = {
        id: row.id,
        school_name: row.school_name,
        city: row.city,
        status: row.status,
        context: row.context ?? '',
        candidates: (candidates ?? []) as Candidate[],
      }
      return { row, item }
    })
    const askable = prepared.filter((p) => p.item.candidates.length > 0)
    for (const p of prepared) {
      if (p.item.candidates.length === 0) {
        outcomes.push({
          id: p.row.id,
          school_name: p.row.school_name,
          city: p.row.city,
          result: p.row.city
            ? `Aucun lycée trouvé à ${p.row.city} dans le référentiel`
            : 'Commune introuvable, même dans la page source',
        })
      }
    }
    const choices =
      askable.length > 0
        ? parseChoices(
            await client.generate({
              system: REANALYSIS_SYSTEM_PROMPT,
              user: buildReanalysisPrompt(askable.map((p) => p.item)),
              schema: REANALYSIS_SCHEMA,
            }),
            askable.map((p) => p.item),
          )
        : new Map<string, string>()

    for (const { row, item } of askable) {
      const uai = choices.get(row.id)
      if (!uai) {
        outcomes.push({
          id: row.id,
          school_name: row.school_name,
          city: row.city,
          result: `Pas de choix sûr parmi ${item.candidates.length} lycée${item.candidates.length > 1 ? 's' : ''} candidat${item.candidates.length > 1 ? 's' : ''} : à rattacher à la main`,
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
  } catch (e) {
    return json(502, { error: e instanceof Error ? e.message : 'Gemini indisponible' })
  }

  return json(200, {
    model: [...client.served].join(', ') || null,
    gemini_calls: client.calls,
    tokens: totalUsage(client.usage),
    linked: outcomes.filter((o) => o.uai).length,
    total: rows.length,
    outcomes,
  })
})
