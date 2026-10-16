/**
 * The saved pages: `<sha256(url)>.html` files, plus `urls.json` that maps them back to URLs.
 * Raw press HTML is copyrighted and big, so it never goes in git: it lives in a private bucket
 * (see bench/README.md) or in a local folder. Labels (hashes and sentences) are in git.
 */
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface Page {
  /** First 10 hex characters of sha256(url): how the datasets refer to a page. */
  hash: string
  url: string
  domain: string
  html: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^(www|m|amp)\./, '')
  } catch {
    return 'unknown'
  }
}

export interface CorpusOptions {
  /** Keep only these page hashes (10 hex characters). */
  only?: ReadonlySet<string>
  limit?: number
  /** Google News links serve a redirect page, not an article: skipped by default. */
  includeGoogleNews?: boolean
}

/** Lists the usable pages of a corpus folder without reading them. */
export async function listCorpus(
  dir: string,
  options: CorpusOptions = {},
): Promise<Array<{ hash: string; url: string; domain: string; file: string }>> {
  const urls: string[] = JSON.parse(await Bun.file(join(dir, 'urls.json')).text())
  const byFile = new Map(urls.map((u) => [`${sha256(u)}.html`, u]))
  const files = new Set(await readdir(join(dir, 'cache')))
  const pages = []
  for (const [file, url] of byFile) {
    if (!files.has(file)) continue
    let isGoogleNews = false
    try {
      isGoogleNews = new URL(url).hostname === 'news.google.com'
    } catch {
      // Invalid corpus URLs are still returned unless the caller filters them elsewhere.
    }
    if (!options.includeGoogleNews && isGoogleNews) continue
    const hash = file.slice(0, 10)
    if (options.only && !options.only.has(hash)) continue
    pages.push({ hash, url, domain: domainOf(url), file: join(dir, 'cache', file) })
  }
  pages.sort((a, b) => a.hash.localeCompare(b.hash))
  return options.limit ? pages.slice(0, options.limit) : pages
}

export async function readPage(
  entry: Awaited<ReturnType<typeof listCorpus>>[number],
): Promise<Page> {
  return {
    hash: entry.hash,
    url: entry.url,
    domain: entry.domain,
    html: await Bun.file(entry.file).text(),
  }
}
