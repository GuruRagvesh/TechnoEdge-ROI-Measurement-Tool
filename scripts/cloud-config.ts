import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
export function cloudOrigin(env: Record<string, string | undefined>) {
  if (env.CODESPACES !== "true" || env.NODE_ENV === "production")
    throw new Error("Private Codespaces development only");
  const name = env.CODESPACE_NAME,
    domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (
    !name ||
    !/^[a-z0-9-]+$/.test(name) ||
    !domain ||
    !/^[a-z0-9.-]+$/.test(domain) ||
    !domain.endsWith(".github.dev") ||
    domain.includes("..")
  )
    throw new Error("Valid GitHub Codespaces forwarding metadata is required");
  return `https://${name}-3000.${domain}`;
}
export async function createCloudEnvironment(
  file: string,
  env: Record<string, string | undefined>,
) {
  const origin = cloudOrigin(env);
  const content = [
    `APP_URL=${origin}`,
    "STORAGE_ADAPTER=local",
    "LOCAL_STORAGE_PATH=.data/cloud-development",
    "MOCK_AUTH=true",
    "LOCAL_TEST_ACCOUNTS=false",
    `IDENTITY_PEPPER=${randomBytes(32).toString("hex")}`,
    "EVIDENCE_MAX_MIB=25",
    "",
  ].join("\n");
  try {
    await writeFile(file, content, { flag: "wx", mode: 0o600 });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}
