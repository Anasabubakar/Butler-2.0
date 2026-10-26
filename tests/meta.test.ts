import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMeta, githubRepo } from "../server/lib/meta.ts";

test("githubRepo finds owner/repo in links into a repository, and nothing else", () => {
  assert.equal(githubRepo("https://github.com/twentyhq/twenty"), "twentyhq/twenty");
  assert.equal(githubRepo("https://www.github.com/twentyhq/twenty/tree/main/docs"), "twentyhq/twenty");
  assert.equal(githubRepo("https://github.com/a/b.git"), "a/b");
  assert.equal(githubRepo("https://github.com/twentyhq"), null);
  assert.equal(githubRepo("https://github.com/topics/crm"), null);
  assert.equal(githubRepo("https://gitlab.com/a/b"), null);
});

test("a GitHub repo is described by its description, topics and README", async () => {
  const server = Deno.serve({ port: 0, onListen() {} }, (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/repos/twentyhq/twenty") {
      return Response.json({ full_name: "twentyhq/twenty", description: "Open source CRM", topics: ["crm", "ai"], language: "TypeScript" });
    }
    if (path === "/repos/twentyhq/twenty/readme") return new Response("# Twenty\n\nA modern <b>CRM</b> with AI agents.");
    return new Response("no", { status: 404 });
  });
  Deno.env.set("GITHUB_API_URL", `http://localhost:${server.addr.port}`);
  try {
    const meta = await fetchMeta("https://github.com/twentyhq/twenty", "github");
    assert.equal(meta.title, "twentyhq/twenty");
    assert.equal(meta.description, "Open source CRM");
    assert.equal(meta.text, "topics: crm, ai\nmain language: TypeScript\nREADME: # Twenty A modern CRM with AI agents.");
  } finally {
    Deno.env.delete("GITHUB_API_URL");
    await server.shutdown();
  }
});
