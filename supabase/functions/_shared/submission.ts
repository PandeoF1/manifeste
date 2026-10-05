import { z } from 'zod'
import { extractDomain } from './domain.ts'
import { REPORT_STATUSES } from './status.ts'

/** Distance maximale entre la position envoyée et le lycée choisi. */
export const MAX_DISTANCE_M = 2000
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const DAILY_LIMIT = 5

/** Arrondi à 3 décimales (~100 m) : on ne garde jamais la position exacte d'une personne. */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000
}

const coord = (min: number, max: number) =>
  z.coerce.number().refine((n) => Number.isFinite(n) && n >= min && n <= max, 'Position invalide.')

/** Champs texte du formulaire de signalement (multipart), validés côté client et serveur. */
export const submissionFieldsSchema = z.object({
  school_uai: z.string().regex(/^[0-9]{7}[A-Z]$/, 'Lycée invalide.'),
  status: z.enum(REPORT_STATUSES, { message: 'Statut invalide.' }),
  lat: coord(-90, 90),
  lng: coord(-180, 180),
  source_url: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || extractDomain(v) !== null,
      'Le lien doit commencer par https://',
    ),
  turnstile_token: z.string().max(4096).optional(),
})
export type SubmissionFields = z.output<typeof submissionFieldsSchema>

/** Codes d'erreur renvoyés par l'Edge Function submit-report. */
export const SUBMIT_ERRORS = {
  invalid_input: 'Le formulaire contient une erreur.',
  captcha_failed: 'La vérification anti-robot a échoué. Réessaie.',
  rate_limited: 'Limite atteinte : 5 signalements par jour. Merci !',
  unknown_school: 'Lycée introuvable.',
  too_far: 'Ta position est trop loin de ce lycée (plus de 2 km).',
  photo_invalid: 'Photo refusée : formats JPEG ou WebP, 5 Mo maximum.',
  photo_metadata:
    'Photo refusée : elle contient encore des métadonnées. Réessaie depuis le formulaire.',
  server_error: 'Erreur du serveur. Réessaie dans un instant.',
} as const
export type SubmitErrorCode = keyof typeof SUBMIT_ERRORS

export type SubmitResponse = { ok: true } | { ok: false; error: SubmitErrorCode; message: string }
