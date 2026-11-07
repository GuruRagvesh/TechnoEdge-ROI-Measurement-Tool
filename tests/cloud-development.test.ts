import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudOrigin, createCloudEnvironment } from "../scripts/cloud-config";
const env = {
  CODESPACES: "true",
  CODESPACE_NAME: "review-example-abc123",
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
};
it("limits cloud development to GitHub metadata and rejects production or ordinary local execution", () => {
  expect(cloudOrigin(env)).toBe(
    "https://review-example-abc123-3000.app.github.dev",
  );
  expect(() => cloudOrigin({ ...env, NODE_ENV: "production" })).toThrow();
  expect(() => cloudOrigin({ ...env, CODESPACES: "false" })).toThrow();
});
it("rejects wildcard, path and foreign-domain cloud forwarding metadata", () => {
  for (const domain of [
    "attacker.invalid",
    "app.github.dev.attacker.invalid",
    "*.github.dev",
    "app.github.dev/path",
    "app..github.dev",
  ])
    expect(() =>
      cloudOrigin({ ...env, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: domain }),
    ).toThrow();
  expect(() => cloudOrigin({ ...env, CODESPACE_NAME: "other/path" })).toThrow();
});
it("creates isolated captured-email configuration without passwords and preserves the stable secret on repeated setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "technoedge-cloud-config-"));
  try {
    const file = join(root, ".env.local");
    expect(await createCloudEnvironment(file, env)).toBe(true);
    const first = await readFile(file, "utf8");
    expect(first).toContain("LOCAL_TEST_ACCOUNTS=false");
    expect(first).toContain("STORAGE_ADAPTER=local");
    expect(first).toContain("MOCK_AUTH=true");
    expect(first).toMatch(/IDENTITY_PEPPER=[a-f0-9]{64}/);
    expect(first).not.toMatch(/GRAPH_|RESEND_|PASSWORD/);
    expect(await createCloudEnvironment(file, env)).toBe(false);
    expect(await readFile(file, "utf8")).toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
