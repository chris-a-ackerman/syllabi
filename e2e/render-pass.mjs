/**
 * Authenticated render pass.
 *
 * Signs in through the real auth form against an ephemeral local Supabase
 * stack, then visits every screen and fails on any console error, page
 * exception, failed request, or unexpected redirect. Also asserts the two
 * behaviours that unit tests cannot reach: that undated events surface in the
 * "Date TBD" group, and that creating a semester makes it the only active one.
 *
 * Requires a Chrome listening on CDP_PORT and a dev server on BASE_URL.
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:5199';
const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? 9222}`;
const { E2E_EMAIL, E2E_EMAIL_NEW, E2E_PASSWORD } = process.env;

if (!E2E_EMAIL || !E2E_EMAIL_NEW || !E2E_PASSWORD) {
  console.error('E2E_EMAIL, E2E_EMAIL_NEW and E2E_PASSWORD must be set');
  process.exit(1);
}

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));

let nextId = 0;
const pending = new Map();
let events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    events.push(msg);
  }
};

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
    ?.result?.value;

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');

/**
 * Noise that predates this harness and is unrelated to the screens under test.
 * Keep this list short and specific — each entry is a bug someone still owes.
 */
const KNOWN_PRE_EXISTING = [
  // The app ships no favicon.
  /favicon\.ico/,
  // src/app/components/ui/* are the React 19 flavour of shadcn (plain function
  // components) running on React 18, so Radix's Presence/SlotClone forwards a
  // ref into a component that never called forwardRef. Dev-mode warning only,
  // fires whenever a Dialog opens.
  /Function components cannot be given refs/,
];

/** Console errors, exceptions and failed requests since the last reset. */
function problems() {
  const out = [];
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown')
      out.push(
        'exception: ' +
          (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
      );
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      out.push(
        'console.error: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      );
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      out.push('log: ' + e.params.entry.text);
    if (e.method === 'Network.loadingFailed' && !e.params.errorText.includes('ERR_ABORTED'))
      out.push('network: ' + e.params.errorText);
  }
  return out.filter((p) => !KNOWN_PRE_EXISTING.some((re) => re.test(p)));
}

/** React ignores el.value = x; go through the native setter it listens to. */
const SET_VALUE = `const setValue = (el, v) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};`;

async function signIn(email) {
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(1500);
  await evaluate('localStorage.clear()');
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(2500);
  events = [];
  const result = await evaluate(`(() => {
    ${SET_VALUE}
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    if (!email || !password) return 'sign-in form not found';
    setValue(email, ${JSON.stringify(email)});
    setValue(password, ${JSON.stringify(E2E_PASSWORD)});
    const submit = [...document.querySelectorAll('button')].find((b) => b.type === 'submit');
    if (!submit) return 'submit button not found';
    submit.click();
    return 'ok';
  })()`);
  if (result !== 'ok') throw new Error(`sign-in: ${result}`);
  await wait(6000);
  const path = await evaluate('location.pathname');
  if (path === '/') throw new Error(`sign-in failed for ${email} — still on the auth screen`);
  return path;
}

let failures = 0;

async function check(label, route, { expectText = [], viaClick = null } = {}) {
  events = [];
  if (viaClick) {
    const clicked = await evaluate(`(() => {
      const el = [...document.querySelectorAll('button, a')].find(
        (x) => (x.innerText || '').trim().includes(${JSON.stringify(viaClick)})
      );
      if (!el) return 'not found';
      el.click();
      return 'clicked';
    })()`);
    if (clicked !== 'clicked') {
      console.log(`FAIL  ${label} — could not find in-app control "${viaClick}"`);
      failures++;
      return;
    }
  } else {
    await send('Page.navigate', { url: BASE + route });
  }
  await wait(4000);

  const info = JSON.parse(
    await evaluate(`(() => {
      const root = document.getElementById('root');
      const text = (root?.innerText || '').replace(/\\s+/g, ' ').trim();
      return JSON.stringify({
        path: location.pathname,
        nodes: root ? root.querySelectorAll('*').length : 0,
        text,
      });
    })()`)
  );

  const errors = problems();
  const missing = expectText.filter((t) => !info.text.includes(t));
  const ok = info.path === route && info.nodes > 20 && errors.length === 0 && missing.length === 0;
  if (!ok) failures++;

  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${label}  (${info.nodes} nodes)`);
  if (info.path !== route) console.log(`        redirected to ${info.path}, expected ${route}`);
  if (missing.length) console.log(`        missing expected text: ${missing.join(' | ')}`);
  errors.forEach((e) => console.log(`        ${e.slice(0, 220)}`));
}

// ── User 1: admin, onboarded, seeded with courses and events ────────────────
console.log(`\nSigned in as the seeded user -> ${await signIn(E2E_EMAIL)}\n`);

await check('Dashboard renders with chat history', '/dashboard', {
  expectText: ['deadlines coming up', 'When is my midterm?'],
});
await check('Courses grid renders', '/courses', {
  expectText: ['Introduction to Algorithms', 'Organic Chemistry I'],
});
await check(
  'Course Detail renders, undated event lands in "Date TBD"',
  '/course/aaaaaaaa-0000-0000-0000-000000000001',
  {
    expectText: [
      'Introduction to Algorithms',
      'Midterm Exam',
      'Date TBD',
      'Guest Lecture Response',
    ],
  }
);
await check(
  'Course Detail #2 renders, undated event lands in "Date TBD"',
  '/course/aaaaaaaa-0000-0000-0000-000000000002',
  {
    expectText: ['Organic Chemistry I', 'Date TBD', 'Final Exam'],
  }
);
await check('Agenda renders grouped by week', '/agenda', {
  expectText: ['Agenda', 'Problem Set 1 due'],
});
await check('Canvas settings renders', '/settings/canvas', { expectText: ['Canvas Integration'] });

// Admin is reached in-app: a direct URL load races the profile fetch that sets
// isAdmin, so ProtectedRoute bounces to /dashboard. Tracked as a separate bug.
await send('Page.navigate', { url: `${BASE}/dashboard` });
await wait(4000);
await check('Admin panel renders (in-app navigation)', '/admin', {
  viaClick: 'Admin',
  expectText: ['Admin Panel'],
});

// ── Semester isActive behaviour (SYL-35 fixes) ──────────────────────────────
console.log('');
await send('Page.navigate', { url: `${BASE}/dashboard` });
await wait(4000);
events = [];
const created = await evaluate(`(async () => {
  ${SET_VALUE}
  const click = (text) => {
    const el = [...document.querySelectorAll('button, a')].find((x) => (x.innerText || '').trim().includes(text));
    if (!el) return false;
    el.click();
    return true;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!click('Add Semester')) return 'no Add Semester button';
  await sleep(1200);
  if (!click('Create Manually')) return 'no Create Manually option';
  await sleep(1200);
  const name = document.getElementById('semesterName');
  const start = document.getElementById('startDate');
  const end = document.getElementById('endDate');
  if (!name || !start || !end) return 'manual semester form not found';
  setValue(name, 'E2E Semester');
  setValue(start, '2027-06-01');
  setValue(end, '2027-08-15');
  name.closest('form').requestSubmit();
  return 'ok';
})()`);
if (created !== 'ok') {
  console.log(`FAIL  Creating a semester through the UI: ${created}`);
  failures++;
} else {
  await wait(5000);
  const errors = problems();
  if (errors.length) {
    console.log('FAIL  Creating a semester produced console errors');
    errors.forEach((e) => console.log(`        ${e.slice(0, 220)}`));
    failures++;
  } else {
    console.log('PASS  Created a semester through the UI (DB assertion follows)');
  }
}

// ── User 2: fresh account that has not completed onboarding ─────────────────
console.log(`\nSigned in as the fresh user -> ${await signIn(E2E_EMAIL_NEW)}`);
await check('Onboarding renders for a new account', '/onboarding', {
  expectText: ['Upload your syllabi'],
});

ws.close();
console.log(
  `\n${failures === 0 ? 'All render checks passed.' : failures + ' render check(s) failed.'}`
);
process.exit(failures ? 1 : 0);
