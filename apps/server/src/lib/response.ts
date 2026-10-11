/**
 * A Response from raw bytes. Bun and the DOM typings disagree on whether a Uint8Array is a
 * BodyInit; the web app type-checks the server's routes (Eden), so the cast lives here, once.
 */
export const bytesResponse = (bytes: Uint8Array, headers: Record<string, string>): Response =>
  new Response(bytes as never, { headers })
