/**
 * Scores the school matching on real citations.
 *
 *   bun bench/matching/run.ts [--corpus ~/manifest-corpus] [--show 25]
 *
 * Truth: the 2,705 (article, school) pairs the judge confirmed (`datasets/parser/mentions.jsonl`),
 * resolved to a UAI through the Annuaire de l'éducation (downloaded once into the corpus folder).
 * Input: the way each article cites the school, read from the saved page (the sentence part that
 * starts with "lycée" and shares a distinctive word with the official name). Each citation is
 * matched twice, with the city and without, and compared with the truth: right, wrong (a
 * report attached to the wrong school: the costly error) or nothing (left to a human).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { sql } from 'drizzle-orm'
import { stripGenericWords } from '@manifeste/core'
import { createTestDb } from '@manifeste/db/testing'
import { schema } from '@manifeste/db'
import { parse } from '@manifeste/parser'
import { MatchingService } from '../../apps/server/src/modules/schools/matching.ts'
import { listCorpus, readPage } from '../parser/corpus.ts'
import { loadMentions } from '../parser/datasets.ts'

const { values } = parseArgs({
  options: { corpus: { type: 'string' }, show: { type: 'string', default: '25' } },
})
const corpusDir = values.corpus ?? join(homedir(), 'manifest-corpus')

interface Record {
  identifiant_de_l_etablissement: string
  nom_etablissement: string
  nom_commune: string
  code_departement: string | null
  latitude: number | null
  longitude: number | null
}

const ANNUAIRE_URL =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/exports/json?' +
  new URLSearchParams({
    where: 'type_etablissement="Lycée" and etat="OUVERT"',
    select:
      'identifiant_de_l_etablissement,nom_etablissement,nom_commune,code_departement,latitude,longitude',
  })

async function loadAnnuaire(): Promise<Record[]> {
  const path = join(corpusDir, 'annuaire-lycees.json')
  if (!(await Bun.file(path).exists())) {
    console.log('downloading the annuaire…')
    await Bun.write(path, await (await fetch(ANNUAIRE_URL)).text())
  }
  return JSON.parse(await Bun.file(path).text())
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** How the article cites the school: "lycée" and the words after it that name this school. */
function citation(text: string, officialName: string): string | null {
  const distinctive = new Set(
    stripGenericWords(officialName)
      .split(' ')
      .filter((w) => w.length > 2),
  )
  if (distinctive.size === 0) return null
  const pattern =
    /\b(lyc[ée]es?|cité scolaire|LGT|LPO?)\s+((?:[\p{L}][\p{L}'’-]*\s+){0,5}[\p{L}][\p{L}'’-]*)/giu
  let best: { span: string; hits: number } | null = null
  for (const m of text.matchAll(pattern)) {
    // One school per citation: stop at "et", "ou", "puis"…
    const words: string[] = []
    for (const w of m[2]!.split(/\s+/)) {
      if (/^(et|ou|puis|ainsi|comme|lyc[ée]es?)$/i.test(w)) break
      words.push(w)
    }
    // Keep the words up to the last one that belongs to the school's name.
    let last = -1
    let hits = 0
    words.forEach((w, i) => {
      if (
        norm(w)
          .split(' ')
          .some((piece) => distinctive.has(piece))
      ) {
        last = i
        hits++
      }
    })
    if (hits === 0) continue
    const span = `${m[1]} ${words.slice(0, last + 1).join(' ')}`
    if (!best || hits > best.hits) best = { span, hits }
  }
  return best?.span ?? null
}

const t = await createTestDb()
try {
  const annuaire = [
    ...new Map((await loadAnnuaire()).map((r) => [r.identifiant_de_l_etablissement, r])).values(),
  ]
  await t.db.insert(schema.schools).values(
    annuaire.map((r) => ({
      uai: r.identifiant_de_l_etablissement,
      name: r.nom_etablissement,
      city: r.nom_commune,
      department: r.code_departement?.replace(/^0/, '') ?? null,
      academy: null,
      level: 'secondary' as const,
      location:
        r.latitude != null && r.longitude != null
          ? sql`ST_SetSRID(ST_MakePoint(${r.longitude}, ${r.latitude}), 4326)::geography`
          : null,
    })),
  )
  const matching = new MatchingService(t.db)

  // Truth: official name + city → one UAI.
  const byKey = new Map<string, string[]>()
  for (const r of annuaire) {
    const key = `${norm(r.nom_etablissement)}|${norm(r.nom_commune)}`
    byKey.set(key, [...(byKey.get(key) ?? []), r.identifiant_de_l_etablissement])
  }

  const mentions = (await loadMentions()).filter(
    (m, i, all) => all.findIndex((x) => x.urlHash === m.urlHash && x.school === m.school) === i,
  )
  const pages = new Map((await listCorpus(corpusDir)).map((p) => [p.hash, p] as const))

  interface Case {
    cited: string
    city: string
    truth: string
    official: string
  }
  const cases: Case[] = []
  for (const m of mentions) {
    const uais = byKey.get(`${norm(m.school)}|${norm(m.city)}`)
    const entry = pages.get(m.urlHash)
    if (uais?.length !== 1 || !entry) continue
    const page = parse((await readPage(entry)).html, entry.url)
    const cited = citation(`${page.title}\n${page.text}`, m.school)
    if (cited) cases.push({ cited, city: m.city, truth: uais[0]!, official: m.school })
  }
  console.log(`${cases.length} citations with a known school (of ${mentions.length} mentions)\n`)

  const show = Number(values.show)
  for (const withCity of [true, false]) {
    let right = 0
    let wrong = 0
    let none = 0
    const misses: string[] = []
    for (const c of cases) {
      const got = (await matching.match(c.cited, withCity ? c.city : null))?.uai ?? null
      if (got === c.truth) right++
      else if (got === null) {
        none++
        misses.push(`none   "${c.cited}" (${c.city}) → ${c.official}`)
        if (
          process.env.DEBUG_NONE &&
          c.cited.toLowerCase().includes(process.env.DEBUG_NONE.toLowerCase())
        ) {
          const cs = await matching.candidates(c.cited, c.city, 3)
          console.log(`-- "${c.cited}" (${c.city}) truth ${c.truth} ${c.official}`)
          for (const x of cs)
            console.log(
              `     ${x.uai === c.truth ? '*' : ' '} ${x.score.toFixed(2)} n=${x.nameScore.toFixed(2)} c=${x.cityScore.toFixed(2)} ${x.name} / ${x.city}`,
            )
        }
      } else {
        wrong++
        const gotName = (await matching.candidates(c.cited, withCity ? c.city : null, 1))[0]
        misses.push(
          `WRONG  "${c.cited}" (${c.city}) → ${c.official}  [got: ${gotName?.name} / ${gotName?.city}]`,
        )
      }
    }
    const pct = (n: number) => `${((100 * n) / cases.length).toFixed(1)}%`
    console.log(
      `${withCity ? 'with city   ' : 'without city'}  right ${right} (${pct(right)})  wrong ${wrong} (${pct(wrong)})  none ${none} (${pct(none)})`,
    )
    for (const line of misses
      .filter((l) => withCity || l.startsWith('WRONG'))
      .sort()
      .slice(0, show))
      console.log('   ' + line)
  }
} finally {
  await t.drop()
}
