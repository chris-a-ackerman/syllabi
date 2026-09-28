// Refactor tripwire: nine of the eleven edge functions run with
// verify_jwt = false and enforce auth *inside the handler*. If a rewrite drops
// that in-function check, nothing else in the fast tier would notice — this
// test fails on the source alone, no running stack needed.
import { assert, assertEquals } from '@std/assert';
import { parse } from '@std/toml';

const CONFIG_PATH = new URL('../../config.toml', import.meta.url);
const FUNCTIONS_DIR = new URL('../../functions/', import.meta.url);

// deno-lint-ignore no-explicit-any
const config = parse(await Deno.readTextFile(CONFIG_PATH)) as Record<string, any>;
const fnConfigs: Record<string, { verify_jwt?: boolean; entrypoint?: string }> =
  config.functions ?? {};

function functionDirs(): string[] {
  const dirs: string[] = [];
  for (const entry of Deno.readDirSync(FUNCTIONS_DIR)) {
    if (entry.isDirectory && entry.name !== '_shared') dirs.push(entry.name);
  }
  return dirs.sort();
}

Deno.test('every function directory has a [functions.<name>] block in config.toml', () => {
  const missing = functionDirs().filter((dir) => !(dir in fnConfigs));
  assertEquals(missing, [], `functions missing from config.toml: ${missing.join(', ')}`);
});

Deno.test('every config.toml function block has a matching directory', () => {
  const dirs = new Set(functionDirs());
  const orphaned = Object.keys(fnConfigs).filter((name) => !dirs.has(name));
  assertEquals(orphaned, [], `config.toml blocks without a directory: ${orphaned.join(', ')}`);
});

// SYL-92: a function may delegate to _shared/agent-auth.ts#resolveCaller
// instead of calling auth.getUser inline — it accepts scoped agent tokens as
// well as JWTs. It still has to read the Authorization header itself, import
// the helper and call resolveCaller; the helper's own JWT branch is pinned by
// the next test and its behaviour by tests/unit/agent-auth.test.ts.
function delegatesToAgentAuth(source: string): boolean {
  return (
    /from ["']\.\.\/_shared\/agent-auth\.ts["']/.test(source) && /resolveCaller\(/.test(source)
  );
}

Deno.test('every verify_jwt=false function enforces auth in its handler source', async () => {
  const offenders: string[] = [];
  for (const [name, fn] of Object.entries(fnConfigs)) {
    if (fn.verify_jwt !== false) continue;
    const source = await Deno.readTextFile(new URL(`${name}/index.ts`, FUNCTIONS_DIR));
    const checksAuthHeader = /Authorization/.test(source);
    const resolvesUser = /auth\.getUser\(/.test(source) || delegatesToAgentAuth(source);
    if (!(checksAuthHeader && resolvesUser)) offenders.push(name);
  }
  assertEquals(
    offenders,
    [],
    `verify_jwt=false functions without an in-handler Authorization + auth.getUser check: ${offenders.join(', ')}`
  );
});

Deno.test('the shared agent-auth helper still resolves JWTs with auth.getUser', async () => {
  const helper = await Deno.readTextFile(new URL('_shared/agent-auth.ts', FUNCTIONS_DIR));
  assert(/auth\.getUser\(/.test(helper), '_shared/agent-auth.ts no longer calls auth.getUser(');
});

Deno.test('no function relies on platform JWT verification', () => {
  const verified = Object.entries(fnConfigs)
    .filter(([, fn]) => fn.verify_jwt === true)
    .map(([name]) => name)
    .sort();
  // Deliberate allowlist: adding a function with verify_jwt=true (or flipping
  // one) should be a conscious decision that updates this test. SYL-42 flipped
  // the last two (generate-ics, admin-get-users) to verify_jwt=false so the
  // browser's CORS preflight passes — every function now enforces auth
  // in-handler, which the test above pins for all of them.
  assertEquals(verified, []);
});

Deno.test('sanity: eighteen functions are configured', () => {
  // SYL-72 added save-anthropic-key, test-anthropic-key, delete-anthropic-key
  // and test-canvas-token (11 + 4); SYL-92 added agent-upcoming,
  // create-agent-token and revoke-agent-token (18).
  assert(Object.keys(fnConfigs).length === 18, `expected 18, got ${Object.keys(fnConfigs).length}`);
});
