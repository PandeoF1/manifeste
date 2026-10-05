# Manifest

![Manifest](brand/logo-horizontal.png)

> Déploiement pas à pas : voir [DEPLOIEMENT.md](DEPLOIEMENT.md).

Carte en temps quasi réel des lycées bloqués en France, avec la source de chaque information.

Cette version contient : la carte, les **signalements sur place** (géolocalisés, photo facultative,
validés par le staff), la **collecte automatique** de sources publiques
(canaux Telegram, flux RSS/Atom dont Google Actualités, comptes Bluesky), l'**extraction par IA**
(Gemini, sortie JSON structurée), le rattachement automatique au référentiel des lycées (UAI) et
une administration pour gérer les sources et modérer.

## Fonctionnement de la collecte

```
pg_cron (toutes les 10 min)
  └─> Edge Function `collect` (répartiteur) : jusqu'à 80 sources, les moins récentes d'abord,
      découpées en groupes de 4, un sous-appel `collect` par groupe (4 en parallèle) ;
      chaque sous-appel a son propre budget (2 s CPU, 256 Mo) :
        1. récupère les derniers éléments (t.me/s/<canal>, flux RSS, API publique Bluesky)
        2. ignore ceux déjà traités (table scraped_items, purgée après 7 j) et ceux de plus de 48 h
        3. filtre lexical (lycée, blocus, barrage filtrant…) pour limiter les appels IA
        4. Gemini extrait { lycée, ville, statut, date du fait, certitude } (schéma JSON strict, validé par zod),
           par lots de 20 éléments toutes sources confondues ; 503/429 -> nouvel essai puis modèle
           de secours ; 404 -> modèle suivant
        5. écarte les certitudes "faible" (appels à bloquer, rumeurs, futur)
        6. rattache à un UAI via public.match_school (trigrammes nom + ville) ; un homonyme sans
           ville n'est jamais rattaché -> table unmatched_extractions
        7. insère un report (source_type = celui de la source)
  └─> trigger Postgres : validation automatique
        - source marquée "de confiance" ou domaine dans trusted_domains -> validated
        - sinon, 2 sources différentes concordantes (même lycée, même statut, < 2 h) -> validated
        - sinon pending (file de modération dans /admin)
```

Aucun texte collecté n'est conservé en base : seuls l'identifiant de l'élément (pour la
déduplication) et le lien public de la source sont stockés. Le prompt interdit au modèle de
reprendre des noms de personnes, pseudos ou descriptions.

## Signalements sur place (`/signaler`)

```
téléphone
  1. géolocalisation -> arrondie à ~100 m sur l'appareil (la position exacte ne part jamais)
  2. choix du lycée parmi ceux à moins de 2 km (public.nearby_schools)
  3. statut ; photo facultative : réencodée via canvas (toutes métadonnées supprimées),
     floutage des visages par l'utilisateur
  4. Cloudflare Turnstile
Edge Function submit-report
  - zod, Turnstile (sans transmettre l'IP), photo JPEG/WebP <= 5 Mo et SANS métadonnées
  - distance au lycée <= 2 km
  - 5 envois / jour par empreinte SHA-256(IP + sel du jour) ; le sel est détruit chaque nuit
  - report "utilisateur" toujours en pending ; photo originale dans le bucket privé "submissions" ;
    position arrondie + distance dans report_submissions (lisible par le staff uniquement)
/admin > Modération
  - le staff voit l'original (URL signée 5 min), floute, puis : publier la version floutée
    (bucket public "photos"), valider sans photo, ou rejeter
  - l'original est supprimé dans tous les cas ; purge-submissions efface ceux restés 48 h sans décision
```

Aucun compte, aucun nom, aucune IP en clair, aucune métadonnée de photo n'est conservé.

## Prérequis

- Node 22+
- [Supabase CLI](https://supabase.com/docs/guides/local-development) (pour migrations, fonctions, types)
- Un projet Supabase (PostGIS, pg_cron et pg_net sont disponibles sur tous les plans)
- Une clé API Gemini (Google AI Studio)

## Installation

```bash
npm install
cp .env.example .env.local   # renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Base de données

```bash
supabase link --project-ref <ref>
supabase db push              # applique supabase/migrations
npm run gen:types             # régénère src/lib/database.types.ts
```

Puis activer la collecte planifiée (SQL editor) :

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/collect', 'collect_url');
select vault.create_secret('<COLLECT_SECRET>', 'collect_secret');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-submissions', 'purge_url');
```

La migration `20261004000008_cron.sql` planifie l'appel toutes les 10 minutes. Si les extensions
n'étaient pas encore activées au moment de `db push`, activer `pg_cron` et `pg_net` dans le
dashboard puis rejouer le contenu de cette migration.

### Compte admin

Pas d'inscription publique. Créer l'utilisateur dans le dashboard (Authentication > Users), puis :

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
where email = '<email admin>';
```

## Edge Functions

```bash
supabase secrets set GEMINI_API_KEY=... COLLECT_SECRET=$(openssl rand -hex 32) \
  GEMINI_MODEL=gemini-3.8-flash COLLECT_MIN_CERTAINTY=moyenne TURNSTILE_SECRET_KEY=...
supabase functions deploy collect --no-verify-jwt
supabase functions deploy submit-report --no-verify-jwt
supabase functions deploy purge-submissions --no-verify-jwt
```

Turnstile : créer un widget sur le dashboard Cloudflare, mettre la clé site dans
`VITE_TURNSTILE_SITE_KEY` (front) et la clé secrète dans `TURNSTILE_SECRET_KEY` (fonction).
Sans ces clés, la vérification est désactivée (développement uniquement).

L'authentification est faite dans la fonction : en-tête `x-collect-secret` (cron) ou JWT d'un
compte admin (bouton « Lancer la collecte » dans `/admin`).

## Import du référentiel des lycées

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:schools
npm run import:schools -- --dry-run              # valider sans écrire
npm run import:schools -- --file export.json     # depuis un export local
```

Source : jeu `fr-en-annuaire-education` (data.education.gouv.fr), filtré sur
`type_etablissement = "Lycée"` et `etat = OUVERT`. Le schéma est validé à l'exécution : si le jeu
de données change, le script s'arrête en affichant l'enregistrement reçu.

## Ajouter des sources

Dans `/admin` > Sources :

- **Telegram** : nom d'un canal **public** (`@canal` ou `https://t.me/canal`). Lu via l'aperçu web
  `t.me/s/<canal>`, sans compte ni clé API.
- **RSS / Atom** : n'importe quel flux https. Deux préréglages Google Actualités (« blocus lycée »,
  « lycée bloqué ») couvrent la presse en ligne ; le domaine de l'éditeur réel est utilisé pour la
  validation par `trusted_domains`.
- **Bluesky** : handle d'un compte (API publique, pas d'authentification).

Cocher « Confiance » publie directement les signaux de la source. Sinon ils passent par la
concordance ou la modération. Chaque source peut être lancée à la main (bouton lecture) pour la tester.

## Tests

```bash
npm test          # Vitest : parsers, schéma d'extraction, matching, collecteur, domaines, expiration
npm run test:db   # SQL : migrations + règle de validation, expiration, matching, RLS
                  # (Postgres 16 local avec PostGIS, pg_trgm, unaccent ; utilisateur superuser)
npm run check     # typecheck + lint + tests
```

## Déploiement front

Vercel, preset Vite. Variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_TURNSTILE_SITE_KEY`.
`vercel.json` gère les réécritures SPA et les en-têtes de sécurité (CSP limitée à Supabase,
OpenFreeMap et Cloudflare Turnstile).

Avant la mise en ligne : compléter `src/config/legal.ts` (email de contact, adresses des hébergeurs).

## Aperçus de partage (Discord, Telegram, WhatsApp, X...)

- `api/og` (Vercel Edge) génère l'image 1200 x 630 : chiffres nationaux en direct, ou situation
  d'un lycée avec `?uai=`. Polices Inter embarquées, cache CDN 5 min.
- `api/share` sert aux robots d'aperçu (détectés par user-agent dans `vercel.json`) le HTML de
  l'app avec titre, description et image adaptés. Les visiteurs humains ne passent jamais par là.
- Prévisualisation locale : `npx tsx scripts/preview-og.ts <dossier>`.

## Logo

Poing levé tenant un crayon : le symbole de lutte devient lycéen. Source : `brand/logo-mark.svg`.
`npm run brand` régénère favicon, icônes PWA (192, 512, maskable), apple-touch-icon, image de
partage par défaut et logo horizontal.

## PWA

Installable, fonctionne hors ligne (dernier état connu, gardé dans IndexedDB 24 h), bandeau
« nouvelle version », invitation à l'installation à partir de la 2e visite seulement.
