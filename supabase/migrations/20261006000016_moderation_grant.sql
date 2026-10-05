-- La modération met à jour le statut ET le chemin de la photo publiée (floutée) :
-- le droit de colonne doit couvrir les deux (la RLS limite toujours aux comptes admin).
grant update (moderation, photo_public_path) on public.reports to authenticated;
