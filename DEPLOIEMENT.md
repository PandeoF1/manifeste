# Déploiement de Manifest - pas à pas

Durée : environ 1 h. Coût : 0 € pour démarrer (offres gratuites), sauf Gemini (voir étape 3).
Commandes à lancer depuis la racine du dépôt, sur ton ordinateur (Node 22+).

## 0. Comptes à créer

| Service          | Pour quoi                                                 | Lien                |
| ---------------- | --------------------------------------------------------- | ------------------- |
| Supabase         | base de données, fonctions, stockage photos, compte admin | supabase.com        |
| Vercel           | site web + images de partage                              | vercel.com          |
| Cloudflare       | anti-robot Turnstile du formulaire                        | dash.cloudflare.com |
| Google AI Studio | clé API Gemini (extraction IA)                            | aistudio.google.com |

## 1. Supabase : projet

1. **New project**, région **Europe (Paris `eu-west-3` ou Francfort `eu-central-1`)**. Garde le mot de passe de la base.
2. **Project Settings > API** : note `Project URL`, la clé `anon` (publique) et la clé `service_role` (secrète, jamais dans le front).
3. **Authentication > Sign In / Providers > Email** : décoche **Allow new users to sign up**.
4. **Authentication > URL Configuration** : Site URL = l'adresse Vercel (à mettre à jour à l'étape 6).

## 2. Supabase : base, fonctions, planification

```bash
npm install
npx supabase login
npx supabase link --project-ref <ref>        # <ref> = l'identifiant dans l'URL du projet
npx supabase db push                          # crée tables, RLS, buckets photos, tâches planifiées
```

Dans **SQL Editor**, enregistre les secrets lus par les tâches planifiées (remplace `<ref>` et choisis un secret long) :

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/collect', 'collect_url');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-submissions', 'purge_url');
select vault.create_secret('<COLLECT_SECRET>', 'collect_secret');   -- openssl rand -hex 32
```

Vérifie dans **Database > Extensions** que `pg_cron` et `pg_net` sont actifs, et dans
**Integrations > Cron** que les tâches `collect-sources`, `purge-submissions`, `purge-rate-limits`
et `purge-collector-traces` existent. Si `pg_cron` n'était pas actif lors du `db push`, active-le
puis rejoue dans le SQL Editor le contenu des migrations `20261004000008_cron.sql` et la section 8
de `20261005000010_user_submissions.sql`.

## 3. Clés externes

- **Gemini** : aistudio.google.com > _Get API key_. Active la facturation (offre payante) : sur
  l'offre gratuite, Google peut utiliser les contenus envoyés pour améliorer ses modèles.
  Coût indicatif : quelques euros par mois avec une dizaine de sources.
- **Turnstile** : Cloudflare > _Turnstile_ > _Add widget_, mode _Managed_, domaines : ton domaine
  Vercel (+ `localhost` pour tester). Note la **Site key** et la **Secret key**.

## 4. Supabase : secrets et fonctions

```bash
npx supabase secrets set \
  GEMINI_API_KEY=<clé gemini> \
  GEMINI_MODEL=gemini-3.8-flash \
  COLLECT_SECRET=<le même secret qu'à l'étape 2> \
  COLLECT_MIN_CERTAINTY=moyenne \
  TURNSTILE_SECRET_KEY=<secret key turnstile>

npx supabase functions deploy collect --no-verify-jwt
npx supabase functions deploy submit-report --no-verify-jwt
npx supabase functions deploy purge-submissions --no-verify-jwt
```

Si Gemini est saturé (erreur 503), la collecte réessaie puis bascule sur un modèle de secours
(`GEMINI_FALLBACK_MODELS`, par défaut `gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite`).

## 5. Référentiel des lycées et compte admin

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  npm run import:schools -- --dry-run      # vérifie le format (doit annoncer ~4 000 lycées)
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role> \
  npm run import:schools                   # import réel (relançable)
```

Si le script signale un schéma modifié, envoie-moi sa sortie.

Vérifie dans le SQL Editor : `select count(*) from schools;` doit renvoyer plusieurs milliers.
Sans référentiel, aucun fait extrait par l'IA ne peut être rattaché (tout part dans « Non
rattachés »). Après l'import, clique **Admin > Non rattachés > Réessayer le rattachement
automatique** pour reprendre ceux déjà collectés.

Compte admin : **Authentication > Users > Add user** (email + mot de passe fort, _Auto confirm_), puis :

```sql
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'
where email = '<ton email admin>';
```

## 6. Vercel

1. Pousse le code sur la branche par défaut (fusionne la branche de travail dans `main`).
2. vercel.com > **Add New > Project** > importe le dépôt. Framework : **Vite** (détecté).
3. **Environment Variables** (Production + Preview) :

| Variable                  | Valeur                      |
| ------------------------- | --------------------------- |
| `VITE_SUPABASE_URL`       | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY`  | clé `anon`                  |
| `VITE_TURNSTILE_SITE_KEY` | site key Turnstile          |

4. **Deploy**. Optionnel : _Settings > Domains_ pour un nom de domaine à toi.
5. Reporte l'adresse finale dans Supabase (étape 1.4) et dans le widget Turnstile (étape 3).

## 7. Textes légaux

Remplis `src/config/legal.ts` (email de contact, adresses des hébergeurs), commit, push :
Vercel redéploie tout seul.

## 8. Mise en route

1. `https://<ton-site>/admin` > connexion.
2. **Sources** > clique les deux préréglages Google Actualités, ajoute des canaux Telegram publics
   et des comptes Bluesky. Coche _Confiance_ uniquement pour les sources sûres.
3. **Lancer la collecte** : le tableau indique, par source, les éléments lus, les faits extraits
   par l'IA et les signaux créés. Une colonne _Erreur_ vide = tout va bien.
4. Ensuite la collecte tourne seule toutes les 10 minutes. Les signaux non sûrs arrivent dans
   **Modération** ; les lycées que l'IA n'a pas su identifier dans **Non rattachés**.

## 9. Vérifier les aperçus de partage

- Colle `https://<ton-site>/` puis `https://<ton-site>/lycee/<UAI>` dans Discord, Telegram, WhatsApp.
- Image directe : `https://<ton-site>/api/og` et `https://<ton-site>/api/og?uai=<UAI>`.
- Caches des messageries : Telegram garde l'aperçu en cache (le bot **@WebpageBot** le rafraîchit) ;
  WhatsApp utilise le cache de Facebook (outil _Sharing Debugger_ de Meta).

## 10. Vérifier la PWA

Sur téléphone, ouvre le site deux fois : l'invitation « Installer » apparaît (Android/Chrome).
Sur iPhone : Partager > _Sur l'écran d'accueil_. Coupe le réseau : la carte affiche
« Hors ligne · données de HH:MM ».

## À savoir

- **Montée en charge de la collecte** : chaque passage est découpé en sous-appels de 4 sources
  (chacun a son propre budget de 2 s de CPU et 256 Mo), 4 en parallèle, 80 sources maximum par
  passage (les moins récemment collectées d'abord). Réglable avec `COLLECT_SOURCES_PER_WORKER`,
  `COLLECT_WORKER_CONCURRENCY` et `COLLECT_MAX_SOURCES_PER_RUN`. Les éléments pertinents de
  plusieurs sources partagent le même appel Gemini (lots de 20).

- **Supabase gratuit** met le projet en pause après 7 jours sans activité. La collecte toutes les
  10 minutes le garde actif, mais passe sur l'offre Pro si l'audience grossit.
- **Logs** : Supabase > Edge Functions > _Logs_ (collecte, envois). Aucune IP ni contenu de
  signalement n'y est écrit par le code.
- **Mise à jour du logo** : modifie `brand/logo-mark.svg` puis `npm run brand`.
