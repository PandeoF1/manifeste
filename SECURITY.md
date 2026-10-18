# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability
reporting ("Security" tab, "Report a vulnerability") or write to contact@pandeo.fr.

Useful details: what you found, how to reproduce it, and the impact you expect. You will get an
answer as soon as possible; this is a small volunteer project, so please be patient.

## Scope

In scope: the web app, the API and worker (`apps/server`), the database schema and the
migrations in this repository. Of particular interest: anything that exposes a
visitor's position, a photo, an IP-derived value or an unreviewed report, and any way for a
non-staff account to write data.

Out of scope: denial of service, spam, social engineering, and third-party services (Cloudflare,
Coolify, Google).

Please test only against your own deployment and never access data that is not yours.
