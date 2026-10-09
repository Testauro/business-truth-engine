/**
 * OrangeHRM evidence adapter for BTE.
 *
 * Deliberately thin: it only resolves *how to authenticate* and *which endpoints to read*, then
 * delegates fetching, mapping, health and completeness to BTE's generic HTTP adapter
 * (`createHttpSource` from @bte/sdk). Nothing OrangeHRM-specific enters BTE core.
 *
 * Authentication modes (ORANGEHRM_API_MODE):
 *   token   OrangeHRM Starter API v2 OAuth2 bearer token (ORANGEHRM_API_TOKEN)
 *   session the `orangehrm` cookie from a Playwright storage state file (ORANGEHRM_SESSION_FILE);
 *           reads the same /api/v2 endpoints the web client uses
 *   none    no authorized API access: collect() throws, BTE records the source as unavailable
 *           and every verification that depends on it is UNKNOWN
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CollectContext,
  EvidenceRecord,
  EvidenceSource,
  HttpAuthConfig,
  HttpRequestConfig,
} from '@bte/sdk';
import { createHttpSource } from '@bte/sdk';

export const API_PREFIX = 'web/index.php/api/v2';

export type ApiMode = 'token' | 'session' | 'none';

export interface OrangeHrmAuthEnv {
  ORANGEHRM_API_MODE?: string | undefined;
  ORANGEHRM_API_TOKEN?: string | undefined;
  ORANGEHRM_SESSION_FILE?: string | undefined;
}

/** Employee record as the API serves it (/pim/employees/{empNumber}); a state snapshot stamped with the collection instant. */
export const employeeRecordMapping: HttpRequestConfig['mapping'] = {
  type: 'employee.record',
  items: 'data',
  eventId: { template: 'employee:${empNumber}' },
  occurredAt: { now: true },
  payload: {
    empNumber: 'empNumber',
    employeeId: 'employeeId',
    firstName: 'firstName',
    lastName: 'lastName',
    middleName: 'middleName',
  },
};

/** Leave requests (/leave/employees/leave-requests) that are Scheduled, keyed by employee + dates. */
export const leaveScheduledMapping: HttpRequestConfig['mapping'] = {
  type: 'leave.request.scheduled',
  items: 'data',
  filter: { path: 'leaveBreakdown.0.name', equals: 'Scheduled' },
  eventId: { template: 'leave-scheduled:${id}' },
  occurredAt: { now: true },
  payload: {
    requestId: 'id',
    requestKey: { template: '${employee.empNumber}:${dates.fromDate}:${dates.toDate}' },
    empNumber: 'employee.empNumber',
    leaveTypeId: 'leaveType.id',
    fromDate: 'dates.fromDate',
    toDate: 'dates.toDate',
    lengthDays: 'leaveBreakdown.0.lengthDays',
    entitlementKey: { template: '${employee.empNumber}:${leaveType.id}' },
  },
};

/** Leave entitlements (/leave/leave-entitlements): balance snapshot per employee and leave type. */
export const leaveEntitlementMapping: HttpRequestConfig['mapping'] = {
  type: 'leave.entitlement.snapshot',
  items: 'data',
  eventId: { template: 'entitlement:${id}:${daysUsed}' },
  occurredAt: { now: true },
  payload: {
    entitlementId: 'id',
    entitlementKey: { template: '${employee.empNumber}:${leaveType.id}' },
    empNumber: 'employee.empNumber',
    leaveTypeId: 'leaveType.id',
    entitlement: 'entitlement',
    daysUsed: 'daysUsed',
  },
};

export function resolveApiMode(env: OrangeHrmAuthEnv): ApiMode {
  const mode = (env.ORANGEHRM_API_MODE ?? '').trim().toLowerCase();
  if (mode === 'token' || mode === 'session' || mode === 'none') return mode;
  if (env.ORANGEHRM_API_TOKEN) return 'token';
  if (env.ORANGEHRM_SESSION_FILE) return 'session';
  return 'none';
}

async function sessionCookie(file: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new Error(
      `no OrangeHRM session at ${file}; run the Playwright "setup" project (login) first`,
    );
  }
  const state = JSON.parse(text) as {
    cookies?: { name: string; value: string; expires?: number }[];
  };
  const cookie = state.cookies?.find((c) => c.name === 'orangehrm');
  if (cookie === undefined)
    throw new Error(`session file ${file} has no "orangehrm" cookie; log in again`);
  if (cookie.expires !== undefined && cookie.expires > 0 && cookie.expires * 1000 < Date.now()) {
    throw new Error('OrangeHRM session cookie has expired; log in again');
  }
  return `orangehrm=${cookie.value}`;
}

/** Resolve credentials from the environment at collection time, never at config load. */
export async function resolveAuth(env: OrangeHrmAuthEnv, dir: string): Promise<HttpAuthConfig> {
  const mode = resolveApiMode(env);
  if (mode === 'token') {
    const token = env.ORANGEHRM_API_TOKEN?.trim();
    if (!token) throw new Error('ORANGEHRM_API_MODE=token but ORANGEHRM_API_TOKEN is not set');
    return { type: 'bearer', token };
  }
  if (mode === 'session') {
    const file = path.resolve(dir, env.ORANGEHRM_SESSION_FILE ?? '.auth/session.json');
    return { type: 'header', name: 'cookie', value: await sessionCookie(file) };
  }
  throw new Error(
    'no authorized OrangeHRM API access (ORANGEHRM_API_MODE=none); independent verification is UNKNOWN',
  );
}

export interface OrangeHrmSourceOptions {
  name: string;
  baseUrl: string;
  /** Which endpoints this logical source reads. */
  kind: 'employees' | 'leave';
  env?: OrangeHrmAuthEnv | undefined;
  dir?: string | undefined;
  /** Override auth (tests); otherwise resolved from env on every collect. */
  auth?: HttpAuthConfig | undefined;
  fetchImpl?: Parameters<typeof createHttpSource>[1] | undefined;
}

function employeeRequests(correlation: CollectContext['correlation']): HttpRequestConfig[] {
  const single = correlation?.['empNumber'] !== undefined;
  return [
    {
      url: single
        ? `${API_PREFIX}/pim/employees/\${correlation.empNumber}`
        : `${API_PREFIX}/pim/employees?limit=50&offset=0`,
      method: 'GET',
      headers: {},
      mapping: employeeRecordMapping,
    },
  ];
}

function leaveRequests(correlation: CollectContext['correlation']): HttpRequestConfig[] {
  const emp = correlation?.['empNumber'];
  const from =
    typeof correlation?.['fromDate'] === 'string' ? correlation['fromDate'] : '2020-01-01';
  const to = typeof correlation?.['toDate'] === 'string' ? correlation['toDate'] : '2099-12-31';
  const empFilter = emp === undefined ? '' : `&empNumber=\${correlation.empNumber}`;
  return [
    {
      url: `${API_PREFIX}/leave/employees/leave-requests?limit=50&fromDate=${from}&toDate=${to}&includeEmployees=onlyCurrent&statuses[]=1&statuses[]=2&statuses[]=3${empFilter}`,
      method: 'GET',
      headers: {},
      mapping: leaveScheduledMapping,
    },
    {
      url: `${API_PREFIX}/leave/leave-entitlements?limit=50${empFilter}`,
      method: 'GET',
      headers: {},
      mapping: leaveEntitlementMapping,
    },
  ];
}

/**
 * Build the source. Each collect() resolves auth afresh (tokens rotate, sessions expire) and
 * delegates to BTE's HTTP adapter: HTTP errors, login redirects, non-JSON bodies and mapping
 * drift all surface as an unavailable source, which BTE reports as UNKNOWN with the message.
 */
export function createOrangeHrmSource(options: OrangeHrmSourceOptions): EvidenceSource {
  const env = options.env ?? (process.env as OrangeHrmAuthEnv);
  const dir = options.dir ?? process.cwd();
  return {
    name: options.name,
    authoritative: true,
    async collect(context): Promise<readonly EvidenceRecord[]> {
      const auth = options.auth ?? (await resolveAuth(env, dir));
      const requests =
        options.kind === 'employees'
          ? employeeRequests(context.correlation)
          : leaveRequests(context.correlation);
      const http = createHttpSource(
        {
          type: 'http',
          name: options.name,
          baseUrl: options.baseUrl,
          auth,
          headers: { accept: 'application/json' },
          // A successful read of the record/list reflects OrangeHRM's current state.
          completeness: 'snapshot',
          requests,
        },
        options.fetchImpl,
      );
      return http.collect(context);
    },
  };
}

/** Factory used by bte.config.ts (`type: 'custom'`). */
export default function factory(
  entry: { name: string; options?: Record<string, unknown> | undefined },
  context: { dir: string; env: Readonly<Record<string, string | undefined>> },
): EvidenceSource {
  const baseUrl = entry.options?.['baseUrl'];
  const kind = entry.options?.['kind'];
  if (typeof baseUrl !== 'string' || baseUrl === '')
    throw new Error(`source "${entry.name}": options.baseUrl is required`);
  if (kind !== 'employees' && kind !== 'leave')
    throw new Error(`source "${entry.name}": options.kind must be "employees" or "leave"`);
  return createOrangeHrmSource({
    name: entry.name,
    baseUrl,
    kind,
    env: context.env as OrangeHrmAuthEnv,
    dir: context.dir,
  });
}
