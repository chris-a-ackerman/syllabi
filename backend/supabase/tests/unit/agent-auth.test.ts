// SYL-92: resolveCaller picks the agent-token path for `syl_agent_…` bearers
// (hash lookup, live + scoped only) and the JWT path for everything else.
import { assert, assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import {
  AGENT_TOKEN_PREFIX,
  bearerToken,
  generateAgentToken,
  hashAgentToken,
  type JwtClient,
  resolveCaller,
  type TokenLookupClient,
} from '../../functions/_shared/agent-auth.ts';

interface Row {
  id: string;
  user_id: string;
  token_hash: string;
  scopes: string[];
  revoked_at: string | null;
  last_used_at: string | null;
}

/** In-memory stand-in for the service-role client's agent_tokens calls. */
function fakeService(rows: Row[], opts: { lookupError?: boolean } = {}) {
  const calls = {
    lookups: 0,
    updates: [] as Array<{ id: string; values: Record<string, unknown> }>,
  };
  const client = {
    from(_table: 'agent_tokens') {
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: string) {
              return {
                is(col2: string, _val: null) {
                  return {
                    maybeSingle() {
                      calls.lookups++;
                      if (opts.lookupError) {
                        return Promise.resolve({ data: null, error: { message: 'boom' } });
                      }
                      const row = rows.find(
                        (r) =>
                          (r as unknown as Record<string, unknown>)[col] === val &&
                          r[col2 as 'revoked_at'] === null
                      );
                      return Promise.resolve({
                        data: row ? { id: row.id, user_id: row.user_id, scopes: row.scopes } : null,
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              calls.updates.push({ id, values });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as TokenLookupClient, calls };
}

function fakeJwt(userId: string | null) {
  const seen: string[] = [];
  const factory = (authHeader: string): JwtClient => {
    seen.push(authHeader);
    return {
      auth: {
        getUser: () =>
          Promise.resolve(
            userId
              ? { data: { user: { id: userId } }, error: null }
              : { data: { user: null }, error: { message: 'invalid JWT' } }
          ),
      },
    };
  };
  return { factory, seen };
}

async function rowFor(token: string, extra: Partial<Row> = {}): Promise<Row> {
  return {
    id: 'tok-1',
    user_id: 'user-a',
    token_hash: await hashAgentToken(token),
    scopes: ['read:upcoming'],
    revoked_at: null,
    last_used_at: null,
    ...extra,
  };
}

// ── token format + hashing ───────────────────────────────────────────────────

Deno.test('generateAgentToken: prefix + 43 base64url chars, unique per call', () => {
  const a = generateAgentToken();
  const b = generateAgentToken();
  assertMatch(a, /^syl_agent_[A-Za-z0-9_-]{43}$/);
  assertNotEquals(a, b);
});

Deno.test('hashAgentToken: sha256 hex, deterministic', async () => {
  assertEquals(
    await hashAgentToken('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

Deno.test('bearerToken: parses the Bearer scheme only', () => {
  assertEquals(bearerToken('Bearer abc'), 'abc');
  assertEquals(bearerToken('bearer abc'), 'abc');
  assertEquals(bearerToken('Basic abc'), null);
  assertEquals(bearerToken(null), null);
  assertEquals(bearerToken('Bearer a b'), null);
});

// ── resolveCaller: agent-token path ─────────────────────────────────────────

Deno.test(
  'resolveCaller: a valid agent token resolves to its owner and bumps last_used_at',
  async () => {
    const token = generateAgentToken();
    const svc = fakeService([await rowFor(token)]);
    const jwt = fakeJwt('someone-else');
    const caller = await resolveCaller(`Bearer ${token}`, 'read:upcoming', {
      service: svc.client,
      jwtClient: jwt.factory,
    });
    assertEquals(caller, { ok: true, userId: 'user-a', via: 'agent_token', tokenId: 'tok-1' });
    assertEquals(svc.calls.updates.length, 1);
    assertEquals(svc.calls.updates[0].id, 'tok-1');
    assert(typeof svc.calls.updates[0].values.last_used_at === 'string');
    assertEquals(jwt.seen, [], 'an agent token must never reach the JWT path');
  }
);

Deno.test('resolveCaller: a revoked agent token is rejected', async () => {
  const token = generateAgentToken();
  const svc = fakeService([await rowFor(token, { revoked_at: '2026-09-01T00:00:00Z' })]);
  const caller = await resolveCaller(`Bearer ${token}`, 'read:upcoming', {
    service: svc.client,
    jwtClient: fakeJwt('user-a').factory,
  });
  assertEquals(caller, { ok: false });
  assertEquals(svc.calls.updates, []);
});

Deno.test('resolveCaller: a token without the required scope is rejected', async () => {
  const token = generateAgentToken();
  const svc = fakeService([await rowFor(token, { scopes: ['read:something-else'] })]);
  const caller = await resolveCaller(`Bearer ${token}`, 'read:upcoming', {
    service: svc.client,
    jwtClient: fakeJwt('user-a').factory,
  });
  assertEquals(caller, { ok: false });
  assertEquals(svc.calls.updates, []);
});

Deno.test('resolveCaller: an unknown agent token is rejected, not retried as a JWT', async () => {
  const svc = fakeService([]);
  const jwt = fakeJwt('user-a');
  const caller = await resolveCaller(`Bearer ${generateAgentToken()}`, 'read:upcoming', {
    service: svc.client,
    jwtClient: jwt.factory,
  });
  assertEquals(caller, { ok: false });
  assertEquals(jwt.seen, []);
});

Deno.test('resolveCaller: a malformed syl_agent_ token is rejected without a lookup', async () => {
  const svc = fakeService([]);
  const jwt = fakeJwt('user-a');
  const caller = await resolveCaller(`Bearer ${AGENT_TOKEN_PREFIX}short`, 'read:upcoming', {
    service: svc.client,
    jwtClient: jwt.factory,
  });
  assertEquals(caller, { ok: false });
  assertEquals(svc.calls.lookups, 0);
  assertEquals(jwt.seen, []);
});

Deno.test('resolveCaller: a lookup error fails closed', async () => {
  const token = generateAgentToken();
  const svc = fakeService([await rowFor(token)], { lookupError: true });
  const caller = await resolveCaller(`Bearer ${token}`, 'read:upcoming', {
    service: svc.client,
    jwtClient: fakeJwt('user-a').factory,
  });
  assertEquals(caller, { ok: false });
});

// ── resolveCaller: JWT path ─────────────────────────────────────────────────

Deno.test('resolveCaller: a non-prefixed bearer goes down the JWT path', async () => {
  const svc = fakeService([]);
  const jwt = fakeJwt('user-b');
  const caller = await resolveCaller('Bearer eyJhbGciOi.jwt.sig', 'read:upcoming', {
    service: svc.client,
    jwtClient: jwt.factory,
  });
  assertEquals(caller, { ok: true, userId: 'user-b', via: 'jwt' });
  assertEquals(jwt.seen, ['Bearer eyJhbGciOi.jwt.sig']);
  assertEquals(svc.calls.lookups, 0);
});

Deno.test('resolveCaller: an invalid JWT is rejected', async () => {
  const caller = await resolveCaller('Bearer not-a-jwt', 'read:upcoming', {
    service: fakeService([]).client,
    jwtClient: fakeJwt(null).factory,
  });
  assertEquals(caller, { ok: false });
});

Deno.test('resolveCaller: a missing or non-Bearer header is rejected', async () => {
  const deps = { service: fakeService([]).client, jwtClient: fakeJwt('user-a').factory };
  assertEquals(await resolveCaller(null, 'read:upcoming', deps), { ok: false });
  assertEquals(await resolveCaller('Basic dXNlcjpwYXNz', 'read:upcoming', deps), { ok: false });
});
