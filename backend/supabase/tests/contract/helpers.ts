// Shared fixtures + fetch wrapper for the contract tests. Runs against a real
// local `supabase start` stack; env comes from `supabase status -o env`:
//   SUPABASE_URL (defaults to the local API), SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `${name} not set — export the local stack keys first (supabase status -o env)`,
    );
  }
  return value;
}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOpts);
const anon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, clientOpts);

const PASSWORD = "contract-tests-Password1!";

export interface FixtureUser {
  id: string;
  email: string;
  token: string;
}

export interface Fixtures {
  userA: FixtureUser; // owns semesterA/courseA/eventA
  userB: FixtureUser; // owns courseB — the cross-user target
  semesterA: string;
  courseA: string;
  courseB: string;
}

async function ensureUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (data?.user) return data.user.id;

  // Already exists from a previous run against a warm stack — look it up.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) return existing.id;
  throw new Error(`could not create or find ${email}: ${error?.message ?? listError?.message}`);
}

async function tokenFor(email: string): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

async function insertOne(
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`seed insert into ${table} failed: ${error.message}`);
  return data.id;
}

async function setup(): Promise<Fixtures> {
  const [idA, idB] = await Promise.all([
    ensureUser("contract-user-a@test.local"),
    ensureUser("contract-user-b@test.local"),
  ]);

  // Idempotent reseed: wipe both users' semesters (courses/events cascade).
  const { error: wipeError } = await admin.from("semesters").delete().in("user_id", [idA, idB]);
  if (wipeError) throw new Error(`fixture wipe failed: ${wipeError.message}`);

  const semesterA = await insertOne("semesters", {
    user_id: idA,
    name: "Contract Fall 2026",
    start_date: "2026-08-24",
    end_date: "2026-12-18",
    is_active: true,
  });
  const courseA = await insertOne("courses", {
    user_id: idA,
    semester_id: semesterA,
    name: "Contract Course A",
    code: "CTA101",
  });
  await insertOne("course_events", {
    user_id: idA,
    course_id: courseA,
    title: "Contract Midterm",
    type: "exam",
    date: "2026-10-12",
  });

  const semesterB = await insertOne("semesters", {
    user_id: idB,
    name: "Contract Fall 2026 (B)",
    start_date: "2026-08-24",
    end_date: "2026-12-18",
    is_active: true,
  });
  const courseB = await insertOne("courses", {
    user_id: idB,
    semester_id: semesterB,
    name: "Contract Course B",
    code: "CTB101",
  });

  // The chat kill-switch test relies on this row existing and starting enabled.
  const { error: settingsError } = await admin
    .from("app_settings")
    .upsert({ id: "global", ai_enabled: true });
  if (settingsError) throw new Error(`app_settings seed failed: ${settingsError.message}`);

  const [tokenA, tokenB] = await Promise.all([
    tokenFor("contract-user-a@test.local"),
    tokenFor("contract-user-b@test.local"),
  ]);

  return {
    userA: { id: idA, email: "contract-user-a@test.local", token: tokenA },
    userB: { id: idB, email: "contract-user-b@test.local", token: tokenB },
    semesterA,
    courseA,
    courseB,
  };
}

// Memoized so every test file (same process) shares one seeded fixture set.
let fixturesPromise: Promise<Fixtures> | null = null;
export function getFixtures(): Promise<Fixtures> {
  fixturesPromise ??= setup();
  return fixturesPromise;
}

export interface FnResponse {
  status: number;
  // deno-lint-ignore no-explicit-any
  json: any | null;
  text: string;
}

export async function callFn(
  name: string,
  opts: {
    token?: string;
    body?: unknown;
    method?: string;
    query?: string;
  } = {},
): Promise<FnResponse> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}${opts.query ?? ""}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body (plain-text errors, ICS payloads)
  }
  return { status: res.status, json, text };
}
