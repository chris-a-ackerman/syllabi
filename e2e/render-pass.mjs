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
const evaluate = async (expression) => {
  const msg = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (msg.error) {
    console.log(`        [cdp error] ${JSON.stringify(msg.error)}`);
    return `cdp error: ${msg.error.message}`;
  }
  const details = msg.result?.exceptionDetails;
  if (details)
    console.log(`        [page exception] ${details.exception?.description ?? details.text}`);
  return msg.result?.result?.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Inspector.enable');
await send('Page.enable');
await send('Network.enable');

/**
 * Noise that predates this harness and is unrelated to the screens under test.
 * Keep this list short and specific — each entry is a bug someone still owes.
 */
const KNOWN_PRE_EXISTING = [
  // The app ships no favicon.
  /favicon\.ico/,
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
    if (e.method === 'Inspector.targetCrashed') out.push('tab crashed');
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

  const raw = await evaluate(`(() => {
    const root = document.getElementById('root');
    const text = (root?.innerText || '').replace(/\\s+/g, ' ').trim();
    return JSON.stringify({
      path: location.pathname,
      nodes: root ? root.querySelectorAll('*').length : 0,
      text,
    });
  })()`);
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    console.log(`FAIL  ${label} — could not read the page: ${raw}`);
    failures++;
    return;
  }

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
// ── Notes persist to the DB (SYL-37) ────────────────────────────────────────
// Notes used to live in React state only, so they vanished on reload. This
// walks the real Notes tab and then reloads to prove the row came back.
const COURSE_1 = '/course/aaaaaaaa-0000-0000-0000-000000000001';
const NOTE_TEXT = 'E2E note: midterm covers chapters 1-5';

await send('Page.navigate', { url: BASE + COURSE_1 });
await wait(4000);
events = [];
const noteSaved = await evaluate(`(async () => {
  try {
  ${SET_VALUE}
  // Radix tabs activate on mousedown/focus, so a bare .click() is not enough.
  const press = (text) => {
    const el = [...document.querySelectorAll('button, a')].find(
      (x) => (x.innerText || '').trim().includes(text)
    );
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.focus();
    el.click();
    return true;
  };
  const click = press;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!click('Notes')) return 'no Notes tab';
  await sleep(1000);
  // The seeded note has always been in course_notes; until SYL-37 nothing read it.
  if (!(document.getElementById('root')?.innerText || '').includes('Office hours moved to Thursday'))
    return 'seeded note is not rendered';
  if (!click('Add Note')) return 'no Add Note button';
  await sleep(1000);
  const box = document.querySelector('textarea');
  if (!box) return 'no note textarea';
  setValue(box, ${JSON.stringify(NOTE_TEXT)});
  await sleep(300);
  if (!click('Save Note')) return 'no Save Note button';
  return 'ok';
  } catch (e) {
    return 'exception: ' + ((e && e.stack) || e);
  }
})()`);

if (noteSaved !== 'ok') {
  console.log(`FAIL  Adding a note through the UI: ${noteSaved}`);
  failures++;
} else {
  await wait(3000);
  // Full reload: anything still on screen came back from the database.
  await send('Page.navigate', { url: BASE + COURSE_1 });
  await wait(4000);
  const survived = await evaluate(`(async () => {
    const el = [...document.querySelectorAll('button, a')].find(
      (x) => (x.innerText || '').trim().includes('Notes')
    );
    if (!el) return 'no Notes tab after reload';
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.focus();
    el.click();
    await new Promise((r) => setTimeout(r, 1000));
    return (document.getElementById('root')?.innerText || '').includes(${JSON.stringify(NOTE_TEXT)})
      ? 'ok'
      : 'note missing after reload';
  })()`);
  const errors = problems();
  if (survived === 'ok' && errors.length === 0) {
    console.log('PASS  Seeded note renders, and a note added in the UI survived a reload');
  } else {
    console.log(`FAIL  Note did not persist: ${survived}`);
    errors.forEach((e) => console.log(`        ${e.slice(0, 220)}`));
    failures++;
  }
}

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

// ── The AI kill switch is a real app_settings write (SYL-37) ────────────────
// It used to be client-local: the toggle moved a boolean that reset on reload.
// We are already on /admin from the check above.
console.log('');
events = [];
const disabled = await evaluate(`(async () => {
  try {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (text) =>
    [...document.querySelectorAll('button, a')].find(
      (x) => (x.innerText || '').trim() === text
    );

  const tab = byText('Access Control');
  if (!tab) return 'no Access Control tab';
  tab.click();
  await sleep(1000);

  const sw = document.querySelector('[role="switch"]');
  if (!sw) return 'no AI switch';
  if (sw.getAttribute('aria-checked') !== 'true') return 'AI switch did not start enabled';
  sw.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  sw.click();
  await sleep(1000);

  const confirm = byText('Disable');
  if (!confirm) return 'no Disable confirmation button';
  confirm.click();
  return 'ok';
  } catch (e) {
    return 'exception: ' + ((e && e.stack) || e);
  }
})()`);

if (disabled !== 'ok') {
  console.log(`FAIL  Disabling AI through the admin toggle: ${disabled}`);
  failures++;
} else {
  await wait(3000);
  // Full reload. /admin has to be reached in-app (see the note above), which
  // also means the flag survives a fresh AuthProvider + SettingsProvider mount.
  await send('Page.navigate', { url: `${BASE}/dashboard` });
  await wait(4000);
  events = [];
  const stillOff = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (text) =>
      [...document.querySelectorAll('button, a')].find(
        (x) => (x.innerText || '').trim() === text
      );
    const admin = [...document.querySelectorAll('button, a')].find(
      (x) => (x.innerText || '').trim().includes('Admin')
    );
    if (!admin) return 'no Admin link after reload';
    admin.click();
    await sleep(3000);
    const tab = byText('Access Control');
    if (!tab) return 'no Access Control tab after reload';
    tab.click();
    await sleep(1000);
    const sw = document.querySelector('[role="switch"]');
    if (!sw) return 'no AI switch after reload';
    return sw.getAttribute('aria-checked') === 'false'
      ? 'ok'
      : 'AI switch came back enabled — the write did not persist';
  })()`);
  const errors = problems();
  if (stillOff === 'ok' && errors.length === 0) {
    console.log('PASS  AI kill switch stayed off across a full reload (DB assertion follows)');
  } else {
    console.log(`FAIL  AI kill switch did not persist: ${stillOff}`);
    errors.forEach((e) => console.log(`        ${e.slice(0, 220)}`));
    failures++;
  }
}

// ── Semester isActive behaviour (SYL-35 fixes) ──────────────────────────────
// This used to be one 2.4s async evaluate; twice on CI (runs 33407187881 and
// 33439130655) the page navigated within ~15ms of the form's requestSubmit()
// while that promise was still pending, and Chrome answered "Promise was
// collected" with no further detail. Node-driven steps keep every evaluate
// near-instant so no promise spans a navigation, the pathname probe names an
// unprevented native submit if that is what kills it next time, and one loud
// retry keeps a lone reload from failing the whole pass.
console.log('');

const clickByText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button, a')].find(
      (x) => (x.innerText || '').trim().includes(${JSON.stringify(text)})
    );
    if (!el) return 'not found';
    el.click();
    return 'clicked';
  })()`);

const pollFor = async (expr, ms) => {
  const deadline = Date.now() + ms;
  do {
    if ((await evaluate(`!!(${expr})`)) === true) return true;
    await wait(250);
  } while (Date.now() < deadline);
  return false;
};

const hasControl = (text) =>
  `[...document.querySelectorAll('button, a')].some((x) => (x.innerText || '').trim().includes(${JSON.stringify(text)}))`;

async function attemptSemesterCreation() {
  await send('Page.navigate', { url: `${BASE}/dashboard` });
  await wait(4000);
  events = [];
  if (!(await pollFor(hasControl('Add Semester'), 8000))) return 'no Add Semester button';
  const opened = await clickByText('Add Semester');
  if (opened !== 'clicked') return `no Add Semester button (${opened})`;
  if (!(await pollFor(hasControl('Create Manually'), 5000))) return 'no Create Manually option';
  const manual = await clickByText('Create Manually');
  if (manual !== 'clicked') return `no Create Manually option (${manual})`;
  const formReady = await pollFor(
    `document.getElementById('semesterName') && document.getElementById('startDate') && document.getElementById('endDate')`,
    5000
  );
  if (!formReady) return 'manual semester form not found';
  const submitted = await evaluate(`(() => {
    ${SET_VALUE}
    const name = document.getElementById('semesterName');
    setValue(name, 'E2E Semester');
    setValue(document.getElementById('startDate'), '2027-06-01');
    setValue(document.getElementById('endDate'), '2027-08-15');
    name.closest('form').requestSubmit();
    return 'ok';
  })()`);
  if (submitted !== 'ok') return submitted;
  await wait(1000);
  const where = await evaluate('location.pathname + location.search');
  if (typeof where === 'string' && where.includes('semesterName='))
    return `native form submit was not prevented — landed on ${where}`;
  await wait(5000);
  if (problems().length) return 'console errors after submit';
  return 'ok';
}

/** The navigation/reload trail problems() ignores; printed when the block fails. */
function navigationTrail() {
  for (const e of events) {
    if (e.method === 'Page.frameNavigated' && !e.params.frame?.parentId)
      console.log(`        [navigated] ${e.params.frame.url}`);
    if (e.method === 'Runtime.consoleAPICalled') {
      const text = e.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text.includes('[vite]')) console.log(`        [vite] ${text.slice(0, 220)}`);
    }
  }
}

let semester = await attemptSemesterCreation();
if (semester !== 'ok') {
  console.log(`RETRY Creating a semester through the UI: ${semester}`);
  navigationTrail();
  problems().forEach((e) => console.log(`        ${e.slice(0, 220)}`));
  semester = await attemptSemesterCreation();
}
if (semester !== 'ok') {
  console.log(`FAIL  Creating a semester through the UI: ${semester}`);
  navigationTrail();
  problems().forEach((e) => console.log(`        ${e.slice(0, 220)}`));
  failures++;
} else {
  console.log('PASS  Created a semester through the UI (DB assertion follows)');
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
