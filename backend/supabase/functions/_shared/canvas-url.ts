// SYL-28: SSRF guard for outbound Canvas requests.
//
// Canvas fetches carry the user's decrypted Canvas token as a bearer header and
// their responses are surfaced back to the caller (written into the caller's
// Storage folder, or returned up the chain). Both the `file_url` request field
// and the stored `canvas_base_url` reach `fetch()`, so every such URL goes
// through assertSafeCanvasUrl() first.

export class UnsafeCanvasUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCanvasUrlError";
  }
}

// Loopback, private, link-local (incl. cloud metadata at 169.254.169.254),
// carrier-grade NAT and benchmark ranges.
const BLOCKED_V4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return BLOCKED_V4_CIDRS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((ipv4ToInt(base)! & mask) >>> 0);
  });
}

function isBlockedIPv6(ip: string): boolean {
  const address = ip.toLowerCase();
  if (address === "::" || address === "::1") return true;
  // IPv4-mapped, dotted form (::ffff:169.254.169.254).
  const mappedDotted = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedDotted) return isBlockedIPv4(mappedDotted[1]);
  // IPv4-mapped, hex form — what the URL parser normalises the above to
  // (::ffff:a9fe:a9fe). Rebuild the dotted quad and defer to the IPv4 ranges.
  const mappedHex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isBlockedIPv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join("."));
  }
  // fc00::/7 unique-local, fe80::/10 link-local.
  return /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

function isIpLiteral(host: string): boolean {
  return host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isBlockedHost(host: string): boolean {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (bare.includes(":")) return isBlockedIPv6(bare);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return isBlockedIPv4(bare);
  // A single-label host (no dot) is never a public Canvas instance, but is
  // exactly how internal services are addressed (kong, db, localhost).
  if (!bare.includes(".")) return true;
  return bare.endsWith(".localhost") || bare.endsWith(".internal");
}

/**
 * Throws UnsafeCanvasUrlError unless `rawUrl` is an https:// URL pointing at a
 * public host. When `allowedHost` is given, the URL's host must equal it —
 * used to pin a request-supplied `file_url` to the user's own Canvas instance.
 */
export async function assertSafeCanvasUrl(
  rawUrl: string,
  allowedHost?: string | null,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeCanvasUrlError("Not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeCanvasUrlError("Only https:// URLs may be fetched.");
  }

  const hostname = url.hostname.toLowerCase();

  if (allowedHost !== undefined && allowedHost !== null) {
    if (hostname !== allowedHost.toLowerCase()) {
      throw new UnsafeCanvasUrlError("URL host does not match the connected Canvas instance.");
    }
  }

  if (isBlockedHost(hostname)) {
    throw new UnsafeCanvasUrlError("URL points at a blocked address range.");
  }

  // The literal-IP check above already covers the direct metadata-IP case. Where
  // the runtime exposes DNS resolution, also reject hostnames that resolve into
  // a blocked range. A resolver that is unavailable or fails is not treated as
  // fatal — the fetch itself fails if the host does not resolve.
  const resolveDns = (Deno as unknown as {
    resolveDns?: (query: string, recordType: string) => Promise<string[]>;
  }).resolveDns;

  if (typeof resolveDns === "function" && !isIpLiteral(hostname)) {
    for (const recordType of ["A", "AAAA"]) {
      let records: string[];
      try {
        records = await resolveDns(hostname, recordType);
      } catch {
        continue;
      }
      for (const record of records) {
        if (isBlockedHost(record)) {
          throw new UnsafeCanvasUrlError("URL resolves to a blocked address range.");
        }
      }
    }
  }

  return url;
}

// SYL-57: assertSafeCanvasUrl only validates the URL a fetch *starts* with —
// Deno's fetch follows redirects by default, so a Canvas host under attacker
// control can 3xx the request to a blocked address (e.g. cloud metadata) and
// have the response body read and stored. Canvas API endpoints do not redirect
// in normal use, so any 3xx there is treated as an error. Canvas file downloads
// are the one legitimate exception: Instructure serves them through its inst-fs
// storage layer, which chains multiple 302s (observed: the Canvas host, to a
// per-file *.canvas-user-content.com cluster host, to an inst-fs-*.inscloudgate.net
// backend) before the final signed, self-authenticating response. safeCanvasFetch
// follows a small bounded number of such redirects — each Location revalidated
// with assertSafeCanvasUrl (unpinned, since these storage hosts legitimately
// differ from the original Canvas host) and with Authorization stripped from the
// second hop onward, since forwarding our bearer token to a storage host is
// unnecessary and would leak it outside the user's own Canvas instance.
// Exceeding the hop limit fails closed.
export class CanvasRedirectError extends UnsafeCanvasUrlError {
  constructor(message: string) {
    super(message);
    this.name = "CanvasRedirectError";
  }
}

// SYL-65: Canvas file/download URLs carry a `verifier=` query token that
// grants unauthenticated download of that file — logging one is equivalent
// to logging a bearer credential. Use this wherever a log line needs to name
// which host a Canvas request went to, without the path/query that can carry
// the token (or other per-request identifiers).
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "(invalid URL)";
  }
}

// Generous enough for Instructure's observed inst-fs chain (Canvas host →
// cluster storage host → inst-fs backend, i.e. 2 hops) with headroom, while
// still bounding how many revalidated fetches a single call can trigger.
const MAX_CANVAS_REDIRECTS = 5;

/**
 * Validates `rawUrl` with assertSafeCanvasUrl, then fetches it with
 * `redirect: "manual"` so 3xx responses are surfaced rather than auto-followed.
 * Up to MAX_CANVAS_REDIRECTS hops are allowed (see the CanvasRedirectError
 * comment above): each Location is revalidated with assertSafeCanvasUrl and
 * re-fetched with Authorization stripped from the second hop onward. Exceeding
 * the limit, or any redirect that fails revalidation, throws CanvasRedirectError
 * without an unread body being left dangling.
 */
export async function safeCanvasFetch(
  rawUrl: string,
  init: RequestInit = {},
  allowedHost?: string | null,
): Promise<Response> {
  let url = await assertSafeCanvasUrl(rawUrl, allowedHost);
  let currentInit = init;
  let res = await fetch(url, { ...currentInit, redirect: "manual" });

  for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
    await res.body?.cancel();

    if (hop >= MAX_CANVAS_REDIRECTS) {
      throw new CanvasRedirectError(
        `Canvas host redirected more than ${MAX_CANVAS_REDIRECTS} times; giving up.`,
      );
    }

    const location = res.headers.get("location");
    if (!location) {
      throw new CanvasRedirectError(
        `Canvas host returned a redirect (${res.status}) with no Location header; redirects are not followed.`,
      );
    }

    try {
      url = await assertSafeCanvasUrl(location);
    } catch (err) {
      if (err instanceof UnsafeCanvasUrlError) {
        throw new CanvasRedirectError(
          `Canvas host returned a redirect (${res.status}) to a disallowed URL: ${err.message}`,
        );
      }
      throw err;
    }

    const redirectHeaders = new Headers(currentInit.headers);
    redirectHeaders.delete("Authorization");
    currentInit = { ...currentInit, headers: redirectHeaders };
    res = await fetch(url, { ...currentInit, redirect: "manual" });
  }

  return res;
}
