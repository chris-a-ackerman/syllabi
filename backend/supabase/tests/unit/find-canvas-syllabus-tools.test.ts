import { assertEquals } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { executeTools } from "../../functions/find-canvas-syllabus/tools.ts";
// deno-lint-ignore no-explicit-any
type ToolUseBlock = any;

// SYL-58: get_course_modules fetches every File item's item.url — a value
// that comes from the modules response body, i.e. from whatever host
// canvas_base_url points at. These tests confirm off-host / blocked-range
// item.url values are rejected before any fetch, instead of being followed.
//
// Unit runs have no --allow-net, so Deno.resolveDns rejects and
// assertSafeCanvasUrl treats that as "no resolver" — the host pin and
// literal-range checks (exercised here) are what actually gate the request.

const BASE_URL = "https://canvas.school.edu";
const ALLOWED_HOST = "canvas.school.edu";
const MODULES_URL = `${BASE_URL}/api/v1/courses/123/modules?include[]=items&per_page=5`;

function modulesToolUse(courseId = "123"): ToolUseBlock {
  return {
    type: "tool_use",
    id: "tool_1",
    name: "get_course_modules",
    input: { course_id: courseId },
  };
}

Deno.test("get_course_modules never fetches an off-host or blocked-range item.url; those items come back unavailable", async () => {
  const modulesPayload = [
    {
      id: 1,
      name: "Week 1",
      items: [
        { title: "Syllabus PDF", type: "File", url: `${BASE_URL}/api/v1/files/1` },
        { title: "Evil link", type: "File", url: "https://evil.example.com/steal" },
        { title: "Metadata probe", type: "File", url: "http://169.254.169.254/latest/meta-data/iam/" },
      ],
    },
  ];

  const calls: string[] = [];
  const fetchStub = stub(globalThis, "fetch", (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url === MODULES_URL) {
      return Promise.resolve(new Response(JSON.stringify(modulesPayload), { status: 200 }));
    }
    if (url === `${BASE_URL}/api/v1/files/1`) {
      return Promise.resolve(
        new Response(JSON.stringify({ url: `${BASE_URL}/files/1/download` }), { status: 200 }),
      );
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  try {
    const results = await executeTools(
      [modulesToolUse()],
      "test-token",
      BASE_URL,
      ALLOWED_HOST,
    );

    // Exactly two fetches: the modules list, and the on-host file item.
    assertSpyCalls(fetchStub, 2);
    assertEquals(calls, [MODULES_URL, `${BASE_URL}/api/v1/files/1`]);
    // Neither off-host URL was ever requested.
    assertEquals(calls.includes("https://evil.example.com/steal"), false);
    assertEquals(calls.includes("http://169.254.169.254/latest/meta-data/iam/"), false);

    assertEquals(results.length, 1);
    const toolResult = results[0];
    assertEquals(toolResult.is_error, undefined);
    // deno-lint-ignore no-explicit-any
    const parsed = JSON.parse((toolResult as any).content);
    const items = parsed[0].items;

    assertEquals(items[0].download_url, `${BASE_URL}/files/1/download`);
    assertEquals(items[0].download_url_unavailable, undefined);

    assertEquals(items[1].download_url, null);
    assertEquals(items[1].download_url_unavailable, true);

    assertEquals(items[2].download_url, null);
    assertEquals(items[2].download_url_unavailable, true);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("get_course_modules skips a File item whose url is not a string, without fetching it", async () => {
  const modulesPayload = [
    {
      id: 1,
      name: "Week 1",
      items: [
        { title: "Weird item", type: "File", url: 12345 },
      ],
    },
  ];

  const calls: string[] = [];
  const fetchStub = stub(globalThis, "fetch", (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url === MODULES_URL) {
      return Promise.resolve(new Response(JSON.stringify(modulesPayload), { status: 200 }));
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  try {
    const results = await executeTools(
      [modulesToolUse()],
      "test-token",
      BASE_URL,
      ALLOWED_HOST,
    );

    // Only the modules list is fetched — the malformed item.url is never used.
    assertSpyCalls(fetchStub, 1);
    assertEquals(calls, [MODULES_URL]);

    // deno-lint-ignore no-explicit-any
    const parsed = JSON.parse((results[0] as any).content);
    const items = parsed[0].items;
    assertEquals(items[0], { title: "Weird item", type: "File", url: 12345 });
    assertEquals(items[0].download_url, undefined);
  } finally {
    fetchStub.restore();
  }
});
