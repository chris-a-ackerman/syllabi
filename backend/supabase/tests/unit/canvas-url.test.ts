import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import {
  assertSafeCanvasUrl,
  CanvasRedirectError,
  safeCanvasFetch,
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

// SYL-57: safeCanvasFetch adds redirect handling on top of assertSafeCanvasUrl.
// Unit runs have no --allow-net, so we can't stand up a real redirecter —
// instead stub globalThis.fetch to return the redirect/response we want to
// exercise, always restoring it in `finally`.

Deno.test("safeCanvasFetch rejects a 302 pointing at cloud metadata and never reads the body", async () => {
  const fetchStub = stub(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data/" },
      }),
    )
  );
  try {
    await assertRejects(
      () => safeCanvasFetch("https://canvas.instructure.com/api/v1/courses"),
      CanvasRedirectError,
    );
    assertSpyCalls(fetchStub, 1);
    const [, init] = fetchStub.calls[0].args;
    assertEquals((init as RequestInit).redirect, "manual");
  } finally {
    fetchStub.restore();
  }
});

Deno.test("safeCanvasFetch rejects every other 3xx status too", async () => {
  for (const status of [301, 303, 307, 308]) {
    const fetchStub = stub(globalThis, "fetch", () =>
      Promise.resolve(
        new Response(null, {
          status,
          headers: { Location: "https://elsewhere.example.com/" },
        }),
      )
    );
    try {
      await assertRejects(
        () => safeCanvasFetch("https://canvas.instructure.com/api/v1/courses"),
        CanvasRedirectError,
      );
      assertSpyCalls(fetchStub, 1);
    } finally {
      fetchStub.restore();
    }
  }
});

Deno.test("safeCanvasFetch passes a 200 response through with a readable body", async () => {
  const fetchStub = stub(globalThis, "fetch", () =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  );
  try {
    const res = await safeCanvasFetch("https://canvas.instructure.com/api/v1/courses");
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    assertSpyCalls(fetchStub, 1);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("safeCanvasFetch rejects an unsafe URL before ever calling fetch", async () => {
  const fetchStub = stub(globalThis, "fetch", () =>
    Promise.resolve(new Response(null, { status: 200 }))
  );
  try {
    await assertRejects(
      () => safeCanvasFetch("http://canvas.instructure.com/api/v1/courses"),
      UnsafeCanvasUrlError,
    );
    await assertRejects(
      () => safeCanvasFetch("https://169.254.169.254/latest/meta-data/"),
      UnsafeCanvasUrlError,
    );
    assertSpyCalls(fetchStub, 0);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("safeCanvasFetch enforces allowedHost before ever calling fetch", async () => {
  const fetchStub = stub(globalThis, "fetch", () =>
    Promise.resolve(new Response(null, { status: 200 }))
  );
  try {
    await assertRejects(
      () => safeCanvasFetch("https://evil.example.com/file.pdf", {}, "canvas.school.edu"),
      UnsafeCanvasUrlError,
    );
    assertSpyCalls(fetchStub, 0);
  } finally {
    fetchStub.restore();
  }
});
