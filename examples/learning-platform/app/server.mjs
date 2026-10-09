// Stub online-learning platform. Two "systems": enrollments and course access, behind one HTTP
// server. Faults are seeded only in the access-provisioning path, so the enrollment UI and API
// always report success. A controllable clock lets tests reach the 60s deadline without waiting.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4310);
const TOKEN = process.env.LMS_API_TOKEN ?? 'lms-dev-token';
const START = process.env.LMS_CLOCK_START ?? '2026-05-01T09:00:00.000Z';
const ACCESS_DELAY_MS = 90_000; // > the 60s business deadline

let now = Date.parse(START);
let fault = process.env.LMS_FAULT ?? 'none'; // none | missing-access | wrong-course | access-api-down | delayed-access
let seq = 0;
const enrollments = new Map(); // id -> { enrollmentId, learnerId, courseId, confirmedAt }
const grants = new Map(); // id -> { accessId, enrollmentId, learnerId, courseId, grantedAt }
const scheduled = []; // { enrollment, dueAt }

const iso = (ms) => new Date(ms).toISOString();
const nextId = (p) => `${p}_${String(++seq).padStart(4, '0')}`;

function provision(enrollment) {
  if (fault === 'missing-access') return;
  if (fault === 'delayed-access') {
    scheduled.push({ enrollment, dueAt: now + ACCESS_DELAY_MS });
    return;
  }
  const access = {
    accessId: nextId('acc'),
    enrollmentId: enrollment.enrollmentId,
    learnerId: enrollment.learnerId,
    courseId: fault === 'wrong-course' ? 'course-intro-to-nothing' : enrollment.courseId,
    grantedAt: iso(now),
  };
  grants.set(access.accessId, access);
}

function tick() {
  for (let i = scheduled.length - 1; i >= 0; i -= 1) {
    if (scheduled[i].dueAt <= now) {
      const { enrollment } = scheduled.splice(i, 1)[0];
      const prev = fault;
      fault = 'none';
      provision(enrollment);
      fault = prev;
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function page(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Learn.io</title></head><body style="font-family:system-ui;max-width:640px;margin:2rem auto"><h1>Learn.io</h1>${body}</body></html>`;
}

async function readBody(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  if (text === '') return {};
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/json')) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;
  tick();
  try {
    // ---- UI ----
    if (req.method === 'GET' && path === '/') {
      return html(
        res,
        200,
        page(`<h2>Enroll in a course</h2>
<form method="post" action="/enroll">
  <p><label for="learnerId">Learner id</label> <input id="learnerId" name="learnerId" value="learner-42" required></p>
  <p><label for="courseId">Course</label>
    <select id="courseId" name="courseId">
      <option value="course-ts-101">TypeScript 101</option>
      <option value="course-pw-201">Playwright 201</option>
    </select></p>
  <button type="submit">Enroll</button>
</form>`),
      );
    }
    if (req.method === 'POST' && path === '/enroll') {
      const body = await readBody(req);
      const enrollment = {
        enrollmentId: nextId('enr'),
        learnerId: String(body.learnerId),
        courseId: String(body.courseId),
        confirmedAt: iso(now),
      };
      enrollments.set(enrollment.enrollmentId, enrollment);
      provision(enrollment);
      res.writeHead(303, { location: `/enrollments/${enrollment.enrollmentId}` });
      return res.end();
    }
    if (req.method === 'GET' && path.startsWith('/enrollments/')) {
      const e = enrollments.get(path.slice('/enrollments/'.length));
      if (!e) return html(res, 404, page('<p role="alert">Enrollment not found</p>'));
      return html(
        res,
        200,
        page(
          `<h2>Enrollment <span data-testid="enrollment-id">${esc(e.enrollmentId)}</span></h2><p role="status">Enrollment confirmed for ${esc(e.learnerId)} in ${esc(e.courseId)}. Your course access is being set up.</p>`,
        ),
      );
    }
    // ---- JSON APIs (bearer token required) ----
    if (path.startsWith('/api/')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`)
        return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && path === '/api/enrollments')
        return json(res, 200, { enrollments: [...enrollments.values()] });
      if (req.method === 'GET' && path === '/api/access') {
        if (fault === 'access-api-down')
          return json(res, 503, { error: 'access service unavailable' });
        const learner = url.searchParams.get('learnerId');
        return json(res, 200, {
          grants: [...grants.values()].filter((g) => learner === null || g.learnerId === learner),
        });
      }
    }
    // ---- test controls ----
    if (req.method === 'GET' && path === '/admin/clock') return json(res, 200, { now: iso(now) });
    if (req.method === 'POST' && path === '/admin/clock/advance') {
      const body = await readBody(req);
      now += Number(body.ms ?? 0);
      tick();
      return json(res, 200, { now: iso(now) });
    }
    if (req.method === 'PUT' && path === '/admin/fault') {
      const body = await readBody(req);
      fault = String(body.fault ?? 'none');
      return json(res, 200, { fault });
    }
    if (req.method === 'POST' && path === '/admin/reset') {
      enrollments.clear();
      grants.clear();
      scheduled.length = 0;
      fault = 'none';
      return json(res, 200, { ok: true });
    }
    if (path === '/health') return json(res, 200, { ok: true, now: iso(now), fault });
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, { error: String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write(
    `Learn.io stub on http://127.0.0.1:${PORT} (fault=${fault}, clock=${iso(now)})\n`,
  );
});
