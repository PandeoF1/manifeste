import { join } from 'node:path'

const DIR = join(import.meta.dir, '../datasets/parser')

export interface MentionLabel {
  urlHash: string
  domain: string
  school: string
  city: string
}

/** (article, school) pairs: the article was the source of a report about that school. */
export async function loadMentions(): Promise<MentionLabel[]> {
  const text = await Bun.file(join(DIR, 'mentions.jsonl')).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MentionLabel)
}

/** Publication dates (epoch seconds) of articles, as the production pipeline recorded them. */
export async function loadPublicationDates(): Promise<Map<string, number>> {
  const text = await Bun.file(join(DIR, 'publication-dates.csv')).text()
  const map = new Map<string, number>()
  for (const line of text.split('\n').slice(1)) {
    const [hash, epoch] = line.split(',')
    if (hash && epoch) map.set(hash, Number(epoch))
  }
  return map
}
