// SYL-65: tripwire against re-introducing Canvas payload leaks into the logs.
//
// Canvas file/module responses carry `download_url`/`url` fields that embed a
// `verifier=` capability token (unauthenticated download of that file), and
// `html_content`/`syllabus_body` can be a full course page. A `console.*`
// call is safe to log a field like this from only in "shape" form — a
// boolean presence check (`!!x`), a length (`x?.length`), or a host-only
// redaction (`redactUrl(x)`) — never the raw value. This scans the source
// text of every Canvas-related function (no import, no running stack) and
// fails if a `console.*` call interpolates one of these fields any other way,
// or dumps a whole payload via `JSON.stringify(...)`.
import { assert, assertEquals } from '@std/assert';

const FUNCTIONS_DIR = new URL('../../functions/', import.meta.url);

const DANGEROUS_KEYS = ['download_url', 'file_url', 'html_content'];

// Substrings that are never safe in a console.* call, regardless of position —
// there is no legitimate "shape only" form of dumping a whole payload object,
// and "verifier" (the Canvas capability-token query param) has no legitimate
// reason to appear in a log line at all.
const BANNED_SUBSTRINGS = [
  'verifier',
  'JSON.stringify(result',
  'JSON.stringify(block.input',
  'JSON.stringify(foundInput',
  'JSON.stringify(agentResult',
  'JSON.stringify(messages',
  'FULL INPUT',
];

/** Extracts every `${...}` interpolation group from a console.* call's source text. */
function interpolations(call: string): string[] {
  return call.match(/\$\{[^}]*\}/g) ?? [];
}

/**
 * True if `braceContent` references `key` in a form other than the allowed
 * shape-only idioms: `!!<expr>.key`, `<expr>.key?.length` / `.length`, or
 * `redactUrl(<expr>.key)`.
 */
function isUnsafeReference(braceContent: string, key: string): boolean {
  if (!braceContent.includes(key)) return false;
  const safeBoolean = new RegExp(`!!\\s*[\\w.]*\\b${key}\\b`);
  const safeLength = new RegExp(`[\\w.]*\\b${key}\\b\\??\\.length`);
  const safeRedact = new RegExp(`redactUrl\\(\\s*[\\w.]*\\b${key}\\b\\s*\\)`);
  return !(
    safeBoolean.test(braceContent) ||
    safeLength.test(braceContent) ||
    safeRedact.test(braceContent)
  );
}

/** Returns a human-readable violation for every unsafe console.* call found in `source`. */
function findViolations(source: string, label: string): string[] {
  const violations: string[] = [];
  const calls = source.match(/console\.(?:log|error|warn|info)\([\s\S]*?\);/g) ?? [];
  for (const call of calls) {
    for (const banned of BANNED_SUBSTRINGS) {
      if (call.includes(banned)) {
        violations.push(`${label}: banned substring "${banned}" in: ${call.trim()}`);
      }
    }
    for (const key of DANGEROUS_KEYS) {
      for (const brace of interpolations(call)) {
        if (isUnsafeReference(brace, key)) {
          violations.push(`${label}: raw "${key}" interpolation in: ${call.trim()}`);
        }
      }
    }
  }
  return violations;
}

function canvasFunctionDirs(): string[] {
  const dirs: string[] = [];
  for (const entry of Deno.readDirSync(FUNCTIONS_DIR)) {
    if (entry.isDirectory && entry.name !== '_shared' && /canvas/i.test(entry.name)) {
      dirs.push(entry.name);
    }
  }
  return dirs.sort();
}

Deno.test('sanity: at least one canvas function directory exists', () => {
  assert(canvasFunctionDirs().length > 0, 'no functions/*canvas*/ directory found');
});

Deno.test(
  'no console.* call in a Canvas function logs a raw URL, payload dump, or verifier token',
  async () => {
    const violations: string[] = [];
    for (const dir of canvasFunctionDirs()) {
      // index.ts is the required entrypoint; tools.ts (find-canvas-syllabus)
      // holds the actual Canvas API + agent-loop logging and is checked too.
      for (const file of ['index.ts', 'tools.ts']) {
        const url = new URL(`${dir}/${file}`, FUNCTIONS_DIR);
        let source: string;
        try {
          source = await Deno.readTextFile(url);
        } catch {
          continue;
        }
        violations.push(...findViolations(source, `${dir}/${file}`));
      }
    }
    assertEquals(violations, [], `log hygiene violations:\n${violations.join('\n')}`);
  }
);

// ── Self-tests for the checker itself — prove it actually detects the bug ──

Deno.test('log-hygiene checker: flags a raw file_url interpolation', () => {
  const bad = 'console.log(`found: ${foundInput.file_url}`);';
  assert(findViolations(bad, 'synthetic').length > 0);
});

Deno.test('log-hygiene checker: flags a full result dump', () => {
  const bad = 'console.log(`result: ${JSON.stringify(result)}`);';
  assert(findViolations(bad, 'synthetic').length > 0);
});

Deno.test('log-hygiene checker: flags the word verifier appearing at all', () => {
  const bad = 'console.log(`token param: verifier`);';
  assert(findViolations(bad, 'synthetic').length > 0);
});

Deno.test('log-hygiene checker: allows boolean/length/redactUrl shape idioms', () => {
  const good =
    'console.log(`has_file_url=${!!foundInput.file_url} html_content_length=${foundInput.html_content?.length ?? 0} host=${redactUrl(file_url)}`);';
  assertEquals(findViolations(good, 'synthetic'), []);
});

Deno.test(
  'log-hygiene checker: allows plain label text mentioning the field name outside braces',
  () => {
    const good = 'console.error(`REJECTED: source_type=file but file_url missing`);';
    assertEquals(findViolations(good, 'synthetic'), []);
  }
);

// ── SYL-72: extend the tripwire to the BYOK key-management functions ───────
// Unlike a Canvas URL (which has a safe "shape" to log — host, length,
// presence), a Claude key or Canvas token has no safe partial form: any
// direct reference inside a console.* interpolation is a violation. `key` is
// checked with a word-boundary so it doesn't also flag legitimate
// identifiers that merely contain it (encKey, keyError, ANTHROPIC_API_KEY).
const SECRET_FILES = [
  'save-anthropic-key/index.ts',
  'test-anthropic-key/index.ts',
  'delete-anthropic-key/index.ts',
  'test-canvas-token/index.ts',
  '_shared/anthropic-client.ts',
];

const SECRET_IDENTIFIERS = ['canvasToken', 'anthropicKey', 'last4'];
const BARE_KEY_PATTERN = /\bkey\b/;
// A header name with no legitimate reason to appear in a log line at all.
const SECRET_BANNED_SUBSTRINGS = ['x-api-key'];

function findSecretViolations(source: string, label: string): string[] {
  const violations: string[] = [];
  const calls = source.match(/console\.(?:log|error|warn|info)\([\s\S]*?\);/g) ?? [];
  for (const call of calls) {
    if (SECRET_BANNED_SUBSTRINGS.some((banned) => call.toLowerCase().includes(banned))) {
      violations.push(`${label}: banned substring in: ${call.trim()}`);
    }
    for (const brace of call.match(/\$\{[^}]*\}/g) ?? []) {
      if (SECRET_IDENTIFIERS.some((id) => brace.includes(id)) || BARE_KEY_PATTERN.test(brace)) {
        violations.push(`${label}: raw key/token interpolation in: ${call.trim()}`);
      }
    }
  }
  return violations;
}

Deno.test('no console.* call in a BYOK key-management file logs key/token material', async () => {
  const violations: string[] = [];
  for (const file of SECRET_FILES) {
    const url = new URL(file, FUNCTIONS_DIR);
    let source: string;
    try {
      source = await Deno.readTextFile(url);
    } catch {
      continue;
    }
    violations.push(...findSecretViolations(source, file));
  }
  assertEquals(violations, [], `log hygiene violations:\n${violations.join('\n')}`);
});

Deno.test('log-hygiene checker (secrets): flags a raw key interpolation', () => {
  const bad = 'console.log(`saving ${key}`);';
  assert(findSecretViolations(bad, 'synthetic').length > 0);
});

Deno.test('log-hygiene checker (secrets): flags canvasToken and last4 interpolation', () => {
  assert(findSecretViolations('console.log(`token: ${canvasToken}`);', 'synthetic').length > 0);
  assert(findSecretViolations('console.log(`last4: ${last4}`);', 'synthetic').length > 0);
});

Deno.test("log-hygiene checker (secrets): allows identifiers that merely contain 'key'", () => {
  const good =
    'console.error(`get_anthropic_key RPC error: ${keyError.message}`); console.error(`have key: ${!!encKey}`);';
  assertEquals(findSecretViolations(good, 'synthetic'), []);
});
