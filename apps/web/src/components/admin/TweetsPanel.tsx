import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Clipboard, Download, ExternalLink, Image as ImageIcon, Info } from 'lucide-react'
import { download } from '@/lib/mediaExport'
import { cardPng, drawCard } from '@/lib/tweets/card'
import { cardSpec } from '@/lib/tweets/card-spec'
import { RANGES, RANGE_LABEL, figuresFor, parisToday, type Range } from '@/lib/tweets/figures'
import { TEMPLATES, replyText, templateById } from '@/lib/tweets/templates'
import { MAX_TWEET, compose, intentUrl, parseHashtags } from '@/lib/tweets/text'
import { departementsQuery, joursQuery, resumeQuery } from '@/queries/donnees'

const SITE_URL = 'https://manifeste.pandeo.fr'
const DEFAULT_TAGS = '#lycées #mobilisation'

/** Tweet composer: pick a template and a range, get the text, hashtags and a picture with the figures. */
export function TweetsPanel() {
  const resume = useQuery(resumeQuery)
  const jours = useQuery(joursQuery)
  const zones = useQuery(departementsQuery)
  const canvas = useRef<HTMLCanvasElement>(null)

  const [templateId, setTemplateId] = useState(TEMPLATES[0]?.id ?? 'bilan')
  const [range, setRange] = useState<Range>('all')
  const [tags, setTags] = useState(DEFAULT_TAGS)
  const [url, setUrl] = useState(SITE_URL)
  // X shows a post with an outside link to fewer people: the link goes in the first reply.
  const [linkInReply, setLinkInReply] = useState(true)
  // The body is generated; once edited by hand it stays until the template or range changes.
  const [edited, setEdited] = useState<string | null>(null)
  const [copied, setCopied] = useState<'text' | 'image' | 'reply' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const template = templateById(templateId)
  const data = useMemo(
    () =>
      resume.data && jours.data && zones.data
        ? {
            resume: resume.data,
            jours: jours.data,
            departements: zones.data,
            today: parisToday(),
          }
        : null,
    [resume.data, jours.data, zones.data],
  )
  const figures = useMemo(() => (data ? figuresFor(data, range) : null), [data, range])
  const generated = data && figures ? template.body({ data, figures }) : ''
  const body = edited ?? generated
  const composition = useMemo(
    () => compose(body, linkInReply ? '' : url, parseHashtags(tags)),
    [body, url, tags, linkInReply],
  )
  const reply = replyText(url)
  const spec = useMemo(
    () => (data && figures ? cardSpec(template, data, figures) : null),
    [data, figures, template],
  )

  useEffect(() => {
    if (canvas.current && spec) drawCard(canvas.current, spec)
  }, [spec])

  const pick = (id: string) => {
    setTemplateId(id)
    setEdited(null)
  }
  const pickRange = (r: Range) => {
    setRange(r)
    setEdited(null)
  }

  async function png(): Promise<Blob> {
    if (!canvas.current) throw new Error('Image indisponible')
    return cardPng(canvas.current)
  }
  const flash = (what: 'text' | 'image' | 'reply') => {
    setCopied(what)
    window.setTimeout(() => setCopied(null), 2000)
  }

  async function copyText() {
    setError(null)
    try {
      await navigator.clipboard.writeText(composition.text)
      flash('text')
    } catch {
      setError('Copie impossible : sélectionne le texte à la main.')
    }
  }
  async function copyReply() {
    setError(null)
    try {
      await navigator.clipboard.writeText(reply)
      flash('reply')
    } catch {
      setError('Copie impossible : sélectionne le texte à la main.')
    }
  }
  async function copyImage() {
    setError(null)
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await png() })])
      flash('image')
    } catch {
      setError("Ce navigateur ne copie pas les images : utilise « Télécharger l'image ».")
    }
  }
  async function downloadImage() {
    setError(null)
    try {
      download(await png(), `manifeste-${template.id}-${range}-${parisToday()}.png`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export impossible')
    }
  }

  const pending = resume.isPending || jours.isPending || zones.isPending
  const failure = resume.error ?? jours.error ?? zones.error

  return (
    <div className="mt-4 space-y-5">
      <p className="flex gap-2 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        Chiffres tirés des données ouvertes du site (aucun appel IA, aucun coût). Rien n'est publié
        d'ici : tu copies le texte, tu télécharges l'image et tu les colles dans X.
        {template.usesRange ? '' : ' Ce gabarit ignore la période.'}
      </p>

      {failure && (
        <p className="text-sm text-poor" role="alert">
          Impossible de charger les chiffres : {failure.message}
        </p>
      )}
      {pending && <div className="h-64 animate-pulse rounded-xl bg-surface" />}

      {data && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="space-y-4" aria-label="Composition">
            <div>
              <h2 className="mb-1 text-sm font-semibold">Gabarit</h2>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={t.id === templateId}
                    title={t.hint}
                    onClick={() => pick(t.id)}
                    className="min-h-9 rounded-md border border-border bg-surface px-3 text-sm aria-pressed:border-accent aria-pressed:font-semibold"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">{template.hint}</p>
            </div>

            <div>
              <h2 className="mb-1 text-sm font-semibold">Période</h2>
              <div
                role="group"
                aria-label="Période"
                className={`flex w-fit rounded-lg border border-border bg-surface p-0.5 text-sm ${template.usesRange ? '' : 'opacity-50'}`}
              >
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={r === range}
                    disabled={!template.usesRange}
                    onClick={() => pickRange(r)}
                    className="min-h-9 rounded-md px-3 aria-pressed:bg-bg aria-pressed:font-semibold"
                  >
                    {RANGE_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="tweet-body" className="font-semibold">
                Texte
              </label>
              <textarea
                id="tweet-body"
                rows={6}
                value={body}
                onChange={(e) => setEdited(e.target.value)}
                className="w-full rounded-md border border-border bg-surface p-3 text-sm"
              />
              {edited !== null && (
                <button
                  type="button"
                  className="w-fit text-xs underline"
                  onClick={() => setEdited(null)}
                >
                  Revenir au texte généré
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="field">
                <label htmlFor="tweet-tags" className="font-semibold">
                  Hashtags
                </label>
                <input
                  id="tweet-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="h-10 rounded-md border border-border bg-surface px-3"
                />
              </div>
              <div className="field">
                <label htmlFor="tweet-url" className="font-semibold">
                  Lien du site
                </label>
                <input
                  id="tweet-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-10 rounded-md border border-border bg-surface px-3"
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={linkInReply}
                onChange={(e) => setLinkInReply(e.target.checked)}
              />
              <span>
                Lien en réponse (conseillé)
                <span className="block text-xs text-muted">
                  X montre un post avec lien externe à moins de monde : le post principal reste sans
                  lien, le lien part dans la première réponse.
                </span>
              </span>
            </label>
          </section>

          <section className="space-y-3" aria-label="Aperçu">
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="whitespace-pre-wrap text-sm">{composition.text}</p>
              <p
                className={`mt-2 text-xs ${composition.tooLong ? 'font-semibold text-poor' : 'text-muted'}`}
                aria-live="polite"
              >
                {composition.length} / {MAX_TWEET} caractères
                {composition.droppedTags.length > 0 &&
                  ` · hashtags retirés pour tenir : ${composition.droppedTags.join(' ')}`}
                {composition.tooLong && ' · trop long : raccourcis le texte'}
              </p>
            </div>
            {linkInReply && (
              <div className="rounded-xl border border-dashed border-border bg-surface p-3">
                <p className="text-xs font-semibold text-muted">1re réponse (avec le lien)</p>
                <p className="mt-1 text-sm break-words">{reply}</p>
                <button
                  type="button"
                  className="btn-secondary mt-2 min-h-9 px-3"
                  onClick={() => void copyReply()}
                >
                  {copied === 'reply' ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <Clipboard size={16} aria-hidden="true" />
                  )}
                  {copied === 'reply' ? 'Copiée' : 'Copier la réponse'}
                </button>
              </div>
            )}

            <canvas
              ref={canvas}
              className="w-full rounded-xl border border-border"
              style={{ aspectRatio: '16 / 9' }}
              role="img"
              aria-label="Aperçu de l'image du tweet"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary min-h-10 px-3"
                onClick={() => void copyText()}
              >
                {copied === 'text' ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Clipboard size={16} aria-hidden="true" />
                )}
                {copied === 'text' ? 'Copié' : 'Copier le texte'}
              </button>
              <button
                type="button"
                className="btn-secondary min-h-10 px-3"
                onClick={() => void copyImage()}
              >
                {copied === 'image' ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <ImageIcon size={16} aria-hidden="true" />
                )}
                {copied === 'image' ? 'Copiée' : "Copier l'image"}
              </button>
              <button
                type="button"
                className="btn-secondary min-h-10 px-3"
                onClick={() => void downloadImage()}
              >
                <Download size={16} aria-hidden="true" /> Télécharger l'image
              </button>
              <a
                className="btn-primary min-h-10 px-3 text-sm"
                href={intentUrl(composition.text)}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink size={16} aria-hidden="true" /> Ouvrir dans X
              </a>
            </div>
            <p className="text-xs text-muted">
              « Ouvrir dans X » pré-remplit le texte ; ajoute l'image (collée avec « Copier l'image
              » ou téléchargée) avant de publier.
            </p>
            {error && (
              <p className="text-sm text-poor" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
