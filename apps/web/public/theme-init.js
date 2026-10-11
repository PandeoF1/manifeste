// Thème clair choisi sur cet appareil : appliqué avant le premier affichage (pas de flash).
// Même clé que src/lib/theme.ts. Script externe : la CSP interdit les scripts en ligne.
try {
  if (
    localStorage.getItem('manifeste-theme') === 'light' &&
    !location.pathname.startsWith('/admin')
  ) {
    document.documentElement.classList.replace('theme-dark', 'theme-light')
  }
} catch (e) {}
