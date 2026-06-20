/**
 * Normalizes a server URL by trimming a trailing slash (if present).
 * Used consistently across Forgejo-related modules.
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}
