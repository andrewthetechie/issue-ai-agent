export function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, "");
}
