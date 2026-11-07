import { randomUUID } from "node:crypto";
import { AppError } from "./types";
import { localTestAccountsEnabled } from "./config";
import { createJson, getJson, mutate, safeKey, type Storage } from "./storage";
type Control = { generation: string };
export function assertLocalTestEnabled() {
  if (!localTestAccountsEnabled()) throw new AppError(404, "Not found");
}
export async function testGeneration(base: Storage) {
  assertLocalTestEnabled();
  const current = await createJson<Control>(
    base,
    "local-test-accounts/control.json",
    { generation: randomUUID() },
  );
  return current.generation;
}
export async function resetTestGeneration(base: Storage) {
  assertLocalTestEnabled();
  return (
    await mutate<Control>(base, "local-test-accounts/control.json", () => ({
      generation: randomUUID(),
    }))
  ).generation;
}
export class LocalTestStorage implements Storage {
  private prefix: string;
  constructor(
    private base: Storage,
    generation: string,
  ) {
    assertLocalTestEnabled();
    if (!/^[a-f0-9-]{36}$/.test(generation))
      throw new Error("Invalid test generation");
    this.prefix = `local-test-accounts/generations/${generation}/`;
  }
  read(key: string) {
    assertLocalTestEnabled();
    return this.base.read(this.prefix + safeKey(key));
  }
  write(key: string, data: Buffer, etag: string | null) {
    assertLocalTestEnabled();
    return this.base.write(this.prefix + safeKey(key), data, etag);
  }
  async list(prefix: string) {
    assertLocalTestEnabled();
    return (await this.base.list(this.prefix + safeKey(prefix))).map((key) =>
      key.slice(this.prefix.length),
    );
  }
}
