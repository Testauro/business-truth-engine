import type { EvidenceRecord } from '@bte/core';
import { parseEvidenceNdjson } from '@bte/evidence';
import type { APIRequestContext } from '@playwright/test';

/** Fetch NDJSON evidence over HTTP with Playwright's request context. */
export function httpEvidenceSource(
  request: APIRequestContext,
  url: string,
): () => Promise<EvidenceRecord[]> {
  return async () => {
    const response = await request.get(url);
    if (!response.ok()) {
      throw new Error(
        `evidence fetch failed: ${response.status()} ${response.statusText()} from ${url}`,
      );
    }
    return parseEvidenceNdjson(await response.text(), url);
  };
}
