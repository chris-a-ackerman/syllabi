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
