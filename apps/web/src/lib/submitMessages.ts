import type { SubmitError } from '@manifeste/core'

/** What the report form tells the visitor for each refusal code of the API. */
export const SUBMIT_MESSAGES: Record<SubmitError, string> = {
  invalid_input: 'Le formulaire contient une erreur.',
  captcha_failed: 'La vérification anti-robot a échoué. Réessaie.',
  rate_limited: 'Limite atteinte : 5 signalements par jour. Merci !',
  unknown_school: 'Lycée introuvable.',
  too_far: 'Ta position est trop loin de ce lycée (plus de 2 km).',
  photo_invalid: 'Photo refusée : formats JPEG ou WebP, 5 Mo maximum.',
  photo_metadata:
    'Photo refusée : elle contient encore des métadonnées. Réessaie depuis le formulaire.',
  server_error: 'Erreur du serveur. Réessaie dans un instant.',
}
