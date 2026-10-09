import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectAll } from '@bte/core';
import { HttpSourceError, createHttpSource } from '../src/index.js';

const NOW = Date.parse('2026-01-15T10:03:00.000Z');
let server: Server;
let baseUrl: string;
const seen: { url: string; auth: string | undefined; method: string; body: string }[] = [];
let mode: 'ok' | 'error' | 'html' | 'drift' | 'slow' = 'ok';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
    });
    req.on('end', () => {
      seen.push({
        url: req.url ?? '',
        auth: req.headers.authorization,
        method: req.method ?? '',
        body,
      });
      if (mode === 'error') {
        res.writeHead(503);
        res.end('down');
        return;
      }
      if (mode === 'html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>');
        return;
      }
      if (mode === 'slow') return; // never answers
      const drift = mode === 'drift';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'acc_1',
              learner: 'l1',
              course: 'c1',
              grantedAt: drift ? 'soon' : '2026-01-15T10:00:30Z',
              status: 'active',
            },
            {
              id: 'acc_2',
              learner: 'l2',
              course: 'c1',
              grantedAt: '2026-01-15T10:00:31Z',
              status: 'revoked',
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

const mapping = {
  type: 'access.granted',
  items: 'data',
  filter: { path: 'status', equals: 'active' },
  eventId: { template: 'access:${id}' },
  occurredAt: 'grantedAt',
  payload: { accessId: 'id', learnerId: 'learner', courseId: 'course' },
} as const;

describe('createHttpSource', () => {
  it('fetches with bearer auth, substitutes correlation into the URL, maps and attests a snapshot', async () => {
    mode = 'ok';
    seen.length = 0;
    const source = createHttpSource({
      type: 'http',
      name: 'lms',
      baseUrl,
      auth: { type: 'bearer', token: 'secret-token' },
      requests: [{ url: 'access?course=${correlation.courseId}', mapping }],
    });
    const records = await source.collect({ now: NOW, correlation: { courseId: 'c1' } });
    expect(seen[0]).toMatchObject({
      url: '/access?course=c1',
      auth: 'Bearer secret-token',
      method: 'GET',
    });
    expect(records).toEqual([
      expect.objectContaining({
        kind: 'event',
        eventId: 'access:acc_1',
        type: 'access.granted',
        source: 'lms',
        payload: { accessId: 'acc_1', learnerId: 'l1', courseId: 'c1' },
      }),
      expect.objectContaining({
        kind: 'source',
        source: 'lms',
        status: 'available',
        authoritative: true,
        completeThrough: '2026-01-15T10:03:00.000Z',
      }),
    ]);
  });

  it('supports basic and header auth, POST bodies with correlation, and `none` completeness', async () => {
    mode = 'ok';
    seen.length = 0;
    const basic = createHttpSource({
      type: 'http',
      name: 'a',
      baseUrl,
      auth: { type: 'basic', username: 'u', password: 'p' },
      completeness: 'none',
      requests: [
        {
          url: '/q',
          method: 'POST',
          body: { course: '${correlation.courseId}', page: 1 },
          mapping,
        },
      ],
    });
    const records = await basic.collect({ now: NOW, correlation: { courseId: 'c1' } });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      auth: `Basic ${Buffer.from('u:p').toString('base64')}`,
      body: '{"course":"c1","page":1}',
    });
    expect(records.at(-1)).not.toHaveProperty('completeThrough');
    const header = createHttpSource({
      type: 'http',
      name: 'b',
      baseUrl,
      auth: { type: 'header', name: 'x-api-key', value: 'k' },
      requests: [{ url: '/q', mapping }],
    });
    await header.collect({ now: NOW });
    expect(seen[1]).toMatchObject({ auth: undefined });
  });

  it('a 5xx, a non-JSON body, a mapping drift or a timeout fails the source, and collectAll turns it into an unavailable attestation', async () => {
    const source = createHttpSource({
      type: 'http',
      name: 'lms',
      baseUrl,
      timeoutMs: 300,
      requests: [{ url: '/x', mapping }],
    });
    mode = 'error';
    await expect(source.collect({ now: NOW })).rejects.toThrow(/responded 503/);
    mode = 'html';
    await expect(source.collect({ now: NOW })).rejects.toThrow(/not JSON/);
    mode = 'drift';
    await expect(source.collect({ now: NOW })).rejects.toThrow(
      /mapping for source "lms" failed on 1 item\(s\): #0 occurredAt/,
    );
    mode = 'slow';
    await expect(source.collect({ now: NOW })).rejects.toThrow(HttpSourceError);
    mode = 'error';
    const result = await collectAll([source], { now: NOW });
    expect(result.records).toEqual([
      expect.objectContaining({ kind: 'source', source: 'lms', status: 'unavailable' }),
    ]);
    expect(result.failures[0]?.error).toContain('503');
  });

  it('rejects a relative url without baseUrl, a missing correlation value, and invalid config', async () => {
    const noBase = createHttpSource({
      type: 'http',
      name: 'n',
      requests: [{ url: 'relative', mapping }],
    });
    await expect(noBase.collect({ now: NOW })).rejects.toThrow(
      /relative but the source has no baseUrl/,
    );
    const needsCorrelation = createHttpSource({
      type: 'http',
      name: 'n',
      baseUrl,
      requests: [{ url: '/x?c=${correlation.courseId}', mapping }],
    });
    await expect(needsCorrelation.collect({ now: NOW })).rejects.toThrow(
      /needs correlation.courseId/,
    );
    expect(() => createHttpSource({ type: 'http', name: 'n', requests: [] })).toThrow();
    expect(() =>
      createHttpSource({
        type: 'http',
        name: 'n',
        baseUrl,
        requests: [{ url: '/x', mapping: { ...mapping, items: 'bad path!' } }],
      }),
    ).toThrow();
  });
});
