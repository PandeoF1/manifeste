import { z } from 'zod'

// The CSP forbids eval: zod must not try to compile its validators. This module is imported first
// by main.tsx, so it runs before any route module creates a schema (a schema created earlier
// probes for eval support, which the browser reports as a policy violation).
z.config({ jitless: true })
