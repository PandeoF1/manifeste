# Manifest

Carte en temps quasi réel des lycées bloqués en France, avec la source de chaque information.

Cette première version contient : la carte, la **collecte automatique** de sources publiques
(canaux Telegram, flux RSS/Atom dont Google Actualités, comptes Bluesky), l'**extraction par IA**
(Gemini, sortie JSON structurée), le rattachement automatique au référentiel des lycées (UAI) et
une administration pour gérer les sources et modérer.

## Fonctionnement de la collecte

```
pg_cron (toutes les 10 min)
  └─> Edge Function `collect`
        pour chaque source active (les plus anciennes d'abord, budget ~110 s) :
        1. récupère les derniers éléments (t.me/s/<canal>, flux RSS, API publique Bluesky)
        2. ignore ceux déjà traités (table scraped_items, purgée après 7 j) et ceux de plus de 48 h
        3. filtre lexical (lycée, blocus, barrage filtrant…) pour limiter les appels IA
        4. Gemini extrait { lycée, ville, statut, date du fait, certitude } (schéma JSON strict, validé par zod)
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

## Edge Function `collect`

```bash
supabase secrets set GEMINI_API_KEY=... COLLECT_SECRET=$(openssl rand -hex 32) \
  GEMINI_MODEL=gemini-3.8-flash COLLECT_MIN_CERTAINTY=moyenne
supabase functions deploy collect --no-verify-jwt
```

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

Vercel, preset Vite. Variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
`vercel.json` gère les réécritures SPA et les en-têtes de sécurité (CSP sans aucun tiers hors
Supabase et OpenFreeMap).

## Hors périmètre de cette version

Formulaire public de signalement, liste, fiche lycée, page À propos, PWA/hors ligne.
