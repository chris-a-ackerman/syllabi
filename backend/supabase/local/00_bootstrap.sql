-- Local-only: the parts of a Supabase project that live outside this repo's
-- migrations, recreated on a stock PostgreSQL so `migrations/` can be applied
-- and tested before they are pushed to Supabase.
--
-- This file is NEVER applied to a Supabase project — Supabase provides all of
-- it already. It aims to match Supabase's defaults closely enough that RLS
-- policies, grants and SECURITY DEFINER behaviour reproduce faithfully; it is
-- not a full reimplementation of GoTrue or Storage.

-- ── Roles ───────────────────────────────────────────────────────────────────
-- Same names PostgREST switches into, so CURRENT_USER checks and grants behave
-- as they do in production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN NOINHERIT SUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN;
  END IF;
END;
$$;

GRANT anon, authenticated, service_role TO authenticator;

-- ── Schemas ─────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

-- SYL-30 qualifies pgp_sym_encrypt/pgp_sym_decrypt as extensions.*, matching
-- where Supabase installs pgcrypto. Put it in the same place locally.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public     TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth       TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA storage    TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT UNIQUE,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- Supabase reads the request's JWT claims out of a GUC. Mirroring that is what
-- lets a test impersonate a user: SET request.jwt.claims = '{"sub":"<uuid>"}'.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'role', '')::text;
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

GRANT SELECT ON auth.users TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt()
  TO anon, authenticated, service_role;

-- ── storage ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS storage.buckets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  public BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name      TEXT,
  owner     UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Splits an object name into path segments, as the storage policies rely on.
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parts TEXT[];
BEGIN
  parts := string_to_array(name, '/');
  RETURN parts[1:array_length(parts, 1) - 1];
END;
$$;

GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;

-- ── public schema grants ────────────────────────────────────────────────────
-- Supabase grants the API roles full table privileges and sets the same as a
-- default for future tables, leaving RLS as the only thing standing between a
-- client and a row. Reproducing it is what makes SYL-25 testable locally: on a
-- stock Postgres `authenticated` would have no privileges at all and the
-- escalation would appear fixed when it is not.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
