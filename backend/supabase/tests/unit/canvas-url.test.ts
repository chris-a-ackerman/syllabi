import { assertEquals, assertRejects } from "@std/assert";
import {
  assertSafeCanvasUrl,
  UnsafeCanvasUrlError,
} from "../../functions/_shared/canvas-url.ts";

// Unit runs have no --allow-net, so Deno.resolveDns rejects with
// PermissionDenied and assertSafeCanvasUrl's catch treats it as "no resolver" —
// these tests exercise every branch before DNS.

Deno.test("accepts a public https Canvas host", async () => {
  const url = await assertSafeCanvasUrl("https://canvas.instructure.com/api/v1/courses");
  assertEquals(url.hostname, "canvas.instructure.com");
});

Deno.test("rejects non-https schemes", async () => {
  for (const raw of ["http://canvas.instructure.com", "ftp://canvas.instructure.com", "file:///etc/passwd"]) {
    await assertRejects(() => assertSafeCanvasUrl(raw), UnsafeCanvasUrlError);
  }
});

Deno.test("rejects invalid URLs", async () => {
  await assertRejects(() => assertSafeCanvasUrl("not a url"), UnsafeCanvasUrlError);
});

Deno.test("pins the host when allowedHost is given", async () => {
  await assertRejects(
    () => assertSafeCanvasUrl("https://evil.example.com/file.pdf", "canvas.school.edu"),
    UnsafeCanvasUrlError,
  );
  const ok = await assertSafeCanvasUrl("https://canvas.school.edu/file.pdf", "CANVAS.SCHOOL.EDU");
  assertEquals(ok.hostname, "canvas.school.edu");
});

Deno.test("rejects blocked IPv4 literals (loopback, private, metadata, CGNAT)", async () => {
  const blocked = [
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://172.16.0.1/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/", // cloud metadata
    "https://100.64.0.1/",
    "https://0.0.0.0/",
  ];
  for (const raw of blocked) {
    await assertRejects(() => assertSafeCanvasUrl(raw), UnsafeCanvasUrlError);
  }
});

Deno.test("accepts a public IPv4 literal", async () => {
  const url = await assertSafeCanvasUrl("https://8.8.8.8/");
  assertEquals(url.hostname, "8.8.8.8");
});

Deno.test("rejects blocked IPv6 literals, including IPv4-mapped forms", async () => {
  const blocked = [
    "https://[::1]/",
    "https://[::]/",
    "https://[::ffff:169.254.169.254]/", // dotted mapped form
    "https://[::ffff:a9fe:a9fe]/", // hex mapped form of 169.254.169.254
    "https://[fc00::1]/", // unique-local
    "https://[fe80::1]/", // link-local
  ];
  for (const raw of blocked) {
    await assertRejects(() => assertSafeCanvasUrl(raw), UnsafeCanvasUrlError);
  }
});

Deno.test("rejects single-label and internal-suffix hosts", async () => {
  for (const raw of ["https://kong/", "https://db/", "https://localhost/", "https://api.internal/", "https://foo.localhost/"]) {
    await assertRejects(() => assertSafeCanvasUrl(raw), UnsafeCanvasUrlError);
  }
});

Deno.test("rejects a hostname that resolves into a blocked range (stubbed DNS)", async () => {
  const denoAny = Deno as unknown as {
    resolveDns?: (query: string, recordType: string) => Promise<string[]>;
  };
  const original = denoAny.resolveDns;
  denoAny.resolveDns = (_query: string, recordType: string) =>
    Promise.resolve(recordType === "A" ? ["169.254.169.254"] : []);
  try {
    await assertRejects(
      () => assertSafeCanvasUrl("https://rebind.example.com/"),
      UnsafeCanvasUrlError,
      "resolves to a blocked address range",
    );
  } finally {
    denoAny.resolveDns = original;
  }
});
