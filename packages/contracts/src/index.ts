// Shared request and response schemas (zod), used by the API and the web app.

/** agent-service's recon techniques; agent n runs TECHNIQUES[n % 4]. */
export const TECHNIQUES = ['dns-brute', 'cert-transparency', 'passive-dns', 'web-crawl'] as const;
export type Technique = (typeof TECHNIQUES)[number];
