import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { collectAll } from '@bte/sdk';
import {
  createOrangeHrmSource,
  resolveApiMode,
  resolveAuth,
} from '../../bte/adapters/orangehrm.js';

/** A local stand-in for OrangeHRM's API: no network, no shared demo, every failure mode on demand. */
let server: Server;
let baseUrl: string;
let mode: 'ok' | 'unauthorized' | 'login-redirect' | 'not-found' | 'drift' = 'ok';
const employee = {
  empNumber: 7,
  lastName: 'Doe',
  firstName: 'Jane',
  middleName: '',
  employeeId: '0007',
  terminationId: null,
};

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    const send = (status: number, body: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (mode === 'login-redirect') {
      if (url.includes('/auth/login')) return send(200, '<html>login</html>', 'text/html');
      res.writeHead(302, { location: '/web/index.php/auth/login' });
      return res.end();
    }
    if (
      req.headers.authorization !== 'Bearer good-token' &&
      req.headers.cookie !== 'orangehrm=good-cookie'
    )
      return send(401, { error: { status: '401', text: 'Unauthorized' } });
    if (mode === 'unauthorized')
      return send(401, { error: { status: '401', text: 'token expired' } });
    if (mode === 'not-found')
      return send(404, { error: { status: '404', text: 'Employee not found' } });
    if (url.includes('/pim/employees/7'))
      return send(200, {
        data: mode === 'drift' ? { ...employee, empNumber: undefined } : employee,
        meta: [],
        rels: [],
      });
    if (url.includes('/pim/employees?'))
      return send(200, { data: [employee], meta: { total: 1 }, rels: [] });
    return send(404, { error: 'unknown route' });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const NOW = Date.parse('2026-06-01T09:00:00.000Z');

test.describe('OrangeHRM adapter contract (local stub)', () => {
  test('token mode maps the single-employee endpoint into a contract-valid record plus a snapshot attestation', async () => {
    mode = 'ok';
    const source = createOrangeHrmSource({
      name: 'orangehrm-api',
      baseUrl,
      kind: 'employees',
      auth: { type: 'bearer', token: 'good-token' },
    });
    const records = await source.collect({ now: NOW, correlation: { empNumber: 7 } });
    expect(records).toEqual([
      expect.objectContaining({
        kind: 'event',
        eventId: 'employee:7',
        type: 'employee.record',
        source: 'orangehrm-api',
        occurredAt: '2026-06-01T09:00:00.000Z',
        payload: {
          empNumber: 7,
          employeeId: '0007',
          firstName: 'Jane',
          lastName: 'Doe',
          middleName: '',
        },
      }),
      expect.objectContaining({
        kind: 'source',
        source: 'orangehrm-api',
        status: 'available',
        authoritative: true,
        completeThrough: '2026-06-01T09:00:00.000Z',
      }),
    ]);
  });

  test('without a correlation the list endpoint is read; session mode sends the cookie', async () => {
    mode = 'ok';
    const source = createOrangeHrmSource({
      name: 'orangehrm-api',
      baseUrl,
      kind: 'employees',
      auth: { type: 'header', name: 'cookie', value: 'orangehrm=good-cookie' },
    });
    const records = await source.collect({ now: NOW });
    expect(records.filter((r) => r.kind === 'event')).toHaveLength(1);
  });

  test.describe('failure modes become an unavailable source, never fabricated evidence', () => {
    for (const [name, setMode, auth, pattern] of [
      ['authentication failure', 'ok', { type: 'bearer', token: 'bad' }, /responded 401/],
      ['expired token', 'unauthorized', { type: 'bearer', token: 'good-token' }, /responded 401/],
      [
        'login redirect (session expired)',
        'login-redirect',
        { type: 'bearer', token: 'good-token' },
        /redirected .*auth\/login.*requires authentication/,
      ],
      ['missing record', 'not-found', { type: 'bearer', token: 'good-token' }, /responded 404/],
      [
        'schema drift (empNumber missing)',
        'drift',
        { type: 'bearer', token: 'good-token' },
        /mapping for source "orangehrm-api" failed .*payload\.empNumber/,
      ],
    ] as const) {
      test(name, async () => {
        mode = setMode;
        const source = createOrangeHrmSource({
          name: 'orangehrm-api',
          baseUrl,
          kind: 'employees',
          auth: { ...auth },
        });
        await expect(source.collect({ now: NOW, correlation: { empNumber: 7 } })).rejects.toThrow(
          pattern,
        );
        const result = await collectAll([source], { now: NOW, correlation: { empNumber: 7 } });
        expect(result.records).toEqual([
          expect.objectContaining({
            kind: 'source',
            source: 'orangehrm-api',
            status: 'unavailable',
          }),
        ]);
        expect(result.failures[0]?.error).toMatch(pattern);
      });
    }
  });

  test('credential resolution: explicit mode wins; token/session inferred; none throws a clear message', async () => {
    expect(resolveApiMode({ ORANGEHRM_API_MODE: 'none', ORANGEHRM_API_TOKEN: 'x' })).toBe('none');
    expect(resolveApiMode({ ORANGEHRM_API_TOKEN: 'x' })).toBe('token');
    expect(resolveApiMode({ ORANGEHRM_SESSION_FILE: 'f' })).toBe('session');
    expect(resolveApiMode({})).toBe('none');
    await expect(resolveAuth({ ORANGEHRM_API_MODE: 'token' }, '.')).rejects.toThrow(
      /ORANGEHRM_API_TOKEN is not set/,
    );
    await expect(
      resolveAuth({ ORANGEHRM_API_MODE: 'session', ORANGEHRM_SESSION_FILE: 'nope.json' }, '.'),
    ).rejects.toThrow(/no OrangeHRM session/);
    await expect(resolveAuth({}, '.')).rejects.toThrow(/no authorized OrangeHRM API access/);
    expect(await resolveAuth({ ORANGEHRM_API_TOKEN: 'abc' }, '.')).toEqual({
      type: 'bearer',
      token: 'abc',
    });
  });
});
