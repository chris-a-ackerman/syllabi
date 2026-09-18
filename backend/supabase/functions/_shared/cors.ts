// Shared CORS headers for every Edge Function.
//
// Documented decision (SYL-31): Access-Control-Allow-Origin stays "*".
// These endpoints are pure bearer-token JSON APIs — authentication rides in
// the Authorization header, no cookies or ambient credentials exist, and
// Allow-Credentials is never set, so a wildcard origin exposes nothing a
// direct curl would not. An origin allowlist would only complicate preview
// deployments (every Vercel preview URL differs) without closing any access.
// Revisit if the functions ever set cookies or serve non-JSON documents.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
