# Local migration testing

Rebuilds the whole schema from `migrations/` on a throwaway local PostgreSQL
database and asserts the Wave 0 security fixes hold. Run it before
`supabase db push`.

```bash
npm run db:test
```

## One-time setup

You need a local PostgreSQL you can create databases on — nothing else. No
Docker, no Supabase CLI.

```bash
# macOS
brew install postgresql@17 && brew services start postgresql@17

# Debian/Ubuntu
sudo apt install postgresql-17 && sudo service postgresql start
```

Match production's major version where you can — `config.toml` sets
`major_version = 17`. The migrations here are not version-sensitive, but
matching removes one variable.

Point the script at your server if it isn't on the default socket:

```bash
ADMIN_URL=postgres://postgres@localhost:5432/postgres npm run db:test
TEST_DB=syllabi_scratch npm run db:test        # different database name
npm run db:test -- --no-verify                 # build the schema, skip assertions
```

`ADMIN_URL` is a maintenance connection used only to `DROP`/`CREATE` the test
database — **it drops `$TEST_DB` every run**, so never point it at anything you
care about. The script refuses hostnames containing `supabase.co`.

## What runs, in order

| Step | File | Pushed to Supabase? |
|---|---|---|
| 1 | `00_bootstrap.sql` | **No** — local only |
| 2 | `../migrations/*.sql` in filename order | Yes |
| 3 | `90_prod_drift.sql` | **No** — local only |
| 4 | `99_verify.sql` | **No** — local only |

**`00_bootstrap.sql`** recreates the parts of a Supabase project that live
outside this repo: the `anon` / `authenticated` / `service_role` roles, the
`auth` and `storage` schemas, `auth.uid()`, `storage.foldername()`, pgcrypto in
the `extensions` schema, and — importantly — Supabase's default grant of `ALL
ON ALL TABLES IN SCHEMA public` to the API roles. That last one is what makes
the tests meaningful: on a stock Postgres `authenticated` has no privileges at
all, so a privilege-escalation bug would look fixed when it is not.

**`90_prod_drift.sql`** adds three `courses` columns the Canvas functions read
and write but no migration creates (`canvas_course_id`, `canvas_sync_status`,
`canvas_sync_error`). They were added by hand in the SQL editor. Types are
inferred from the code, not from production — the file says how to confirm them
and promote it to a real migration.

**`99_verify.sql`** seeds two users and asserts, on a real database, that a user
cannot set `is_admin` or `canvas_base_url` on their own row, that an ordinary
`display_name` edit still works, that RLS still isolates users, that the Canvas
token round trip survives the new guard trigger, and that every SECURITY DEFINER
function pins `search_path`. It raises on the first failure, so the script exits
non-zero.

These assertions are known to fail on the pre-fix schema — running them against
`main` aborts with `SYL-25: authenticated was able to set is_admin on its own
row`. That is the check that makes them worth having.

## Impersonating a user in psql

`auth.uid()` reads the same GUC Supabase populates from the JWT, so RLS can be
exercised directly:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<a uuid from auth.users>"}';
SELECT * FROM public.profiles;          -- only that user's row
UPDATE public.profiles SET is_admin = true WHERE id = '<same uuid>';  -- rejected
ROLLBACK;
```

`RESET ROLE` (or ending the transaction) puts you back to superuser, which
bypasses RLS entirely — if a policy seems not to apply, check what role you are.

## Then push

```bash
npm run db:test          # green locally
supabase db push --dry-run
supabase db push
```

## Caveats

This proves the SQL does what it claims. It does **not** prove production
matches this repo — `snippets/` shows schema has been applied by hand, and
`90_prod_drift.sql` documents three columns that reached production without a
migration. Check the live grants and column types before trusting a local
green run for anything security-critical.
