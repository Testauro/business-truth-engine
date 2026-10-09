import type { CollectContext, EvidenceRecord, EvidenceSource } from '@bte/core';
import { MappingError, attestation, mapItems } from '@bte/core';
import type {
  HttpAuthConfig,
  HttpRequestConfig,
  HttpSourceConfig,
  HttpSourceConfigInput,
} from './config.js';
import { HttpSourceConfigSchema } from './config.js';

export class HttpSourceError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpSourceError';
    this.status = status;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function authHeaders(auth: HttpAuthConfig): Record<string, string> {
  switch (auth.type) {
    case 'none':
      return {};
    case 'bearer':
      return { authorization: `Bearer ${auth.token}` };
    case 'basic':
      return {
        authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
      };
    case 'header':
      return { [auth.name]: auth.value };
  }
}

const CORRELATION = /\$\{correlation\.([A-Za-z0-9_]+)\}/g;

function substitute(text: string, correlation: CollectContext['correlation']): string {
  return text.replace(CORRELATION, (_m, key: string) => {
    const value = correlation?.[key];
    if (value === undefined)
      throw new HttpSourceError(`request needs correlation.${key} but none was given`);
    return encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
  });
}

function substituteDeep(value: unknown, correlation: CollectContext['correlation']): unknown {
  if (typeof value === 'string') return substitute(value, correlation);
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, correlation));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        substituteDeep(v, correlation),
      ]),
    );
  }
  return value;
}

function resolveUrl(
  request: HttpRequestConfig,
  baseUrl: string | undefined,
  correlation: CollectContext['correlation'],
): string {
  const text = substitute(request.url, correlation);
  if (/^https?:\/\//.test(text)) return text;
  if (baseUrl === undefined)
    throw new HttpSourceError(
      `request url "${request.url}" is relative but the source has no baseUrl`,
    );
  return new URL(text, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

/**
 * REST adapter. One source = one logical system; it may need several requests
 * (one per event type). Any HTTP failure, timeout, non-JSON body or mapping
 * problem makes the whole source unavailable for this collection: partial
 * evidence must never pass for complete evidence.
 */
export function createHttpSource(
  input: HttpSourceConfigInput,
  fetchImpl: FetchLike = globalThis.fetch,
): EvidenceSource {
  const config: HttpSourceConfig = HttpSourceConfigSchema.parse(input);
  return {
    name: config.name,
    authoritative: config.authoritative,
    async collect(context) {
      const records: EvidenceRecord[] = [];
      for (const request of config.requests) {
        const url = resolveUrl(request, config.baseUrl, context.correlation);
        const headers: Record<string, string> = {
          accept: 'application/json',
          ...config.headers,
          ...request.headers,
          ...authHeaders(config.auth),
        };
        const init: RequestInit = {
          method: request.method,
          headers,
          signal: AbortSignal.timeout(config.timeoutMs),
        };
        if (request.method === 'POST' && request.body !== undefined) {
          headers['content-type'] ??= 'application/json';
          init.body = JSON.stringify(substituteDeep(request.body, context.correlation));
        }
        let response: Response;
        try {
          response = await fetchImpl(url, init);
        } catch (error) {
          throw new HttpSourceError(
            `${request.method} ${url}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!response.ok) {
          throw new HttpSourceError(
            `${request.method} ${url} responded ${response.status} ${response.statusText}`,
            response.status,
          );
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (response.redirected && !contentType.includes('json')) {
          throw new HttpSourceError(
            `${request.method} ${url} was redirected to ${response.url} (${contentType || 'no content type'}); the API likely requires authentication`,
            response.status,
          );
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          throw new HttpSourceError(
            `${request.method} ${url}: response is not JSON (${error instanceof Error ? error.message : String(error)})`,
            response.status,
          );
        }
        const mapped = mapItems(request.mapping, body, {
          source: config.name,
          collectedAt: context.now,
        });
        if (mapped.problems.length > 0) throw new MappingError(config.name, mapped.problems);
        records.push(...mapped.events);
      }
      records.push(
        attestation(config.name, context.now, {
          authoritative: config.authoritative,
          completeThrough: config.completeness === 'snapshot' ? context.now : undefined,
          note: `${config.requests.length} request(s) ok${config.completeness === 'none' ? '; no completeness promised' : ''}`,
        }),
      );
      return records;
    },
  };
}
