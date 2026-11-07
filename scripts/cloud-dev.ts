import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cloudOrigin, createCloudEnvironment } from "./cloud-config";
const action = process.argv[3];
const origin = cloudOrigin(process.env);
if (action === "setup") {
  const created = await createCloudEnvironment(".env.local", process.env);
  console.log(
    created
      ? "Private cloud development configuration created; no company integration or local password bypass enabled."
      : "Existing .env.local preserved. Review it before starting cloud development.",
  );
} else {
  process.loadEnvFile(".env.local");
  if (
    process.env.STORAGE_ADAPTER !== "local" ||
    process.env.MOCK_AUTH !== "true" ||
    process.env.LOCAL_TEST_ACCOUNTS !== "false" ||
    process.env.LOCAL_STORAGE_PATH !== ".data/cloud-development"
  )
    throw new Error(
      "Cloud review requires isolated local storage, captured email and disabled development password accounts",
    );
  if (action === "otp") {
    const email = process.argv[4]?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error(
        "Usage: npm run cloud:otp -- your-test-email@example.com",
      );
    const folder = resolve(".data/cloud-development/dev-mail");
    const records = [];
    for (const name of await readdir(folder)) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
      const mail = JSON.parse(await readFile(resolve(folder, name), "utf8"));
      if (
        mail.email === email &&
        Date.parse(mail.createdAt) > Date.now() - 10 * 60000
      )
        records.push(mail);
    }
    records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (!records[0])
      throw new Error(
        "No recent captured code for that address. Request a code on the private application first.",
      );
    console.log("Development OTP (private terminal only): " + records[0].code);
  } else if (action === "start") {
    console.log(
      "Private cloud development: keep port 3000 PRIVATE. Synthetic records only. " +
        origin,
    );
    const child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "0.0.0.0",
        "--port",
        "3000",
      ],
      {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "development", APP_URL: origin },
      },
    );
    child.on("exit", (code) => (process.exitCode = code ?? 1));
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.on(signal, () => child.kill(signal));
  } else throw new Error("Use cloud:setup, dev:cloud or cloud:otp");
}
