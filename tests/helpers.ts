import { Conflict, type Storage, type Stored } from "../src/lib/storage";
export class MemoryStorage implements Storage {
  files = new Map<string, Stored>();
  failWrites = false;
  async read(k: string) {
    return this.files.get(k) || null;
  }
  async write(k: string, b: Buffer, expected: string | null) {
    if (this.failWrites) throw new Error("Injected storage failure");
    const current = this.files.get(k);
    if ((current?.etag ?? null) !== expected) throw new Conflict();
    const etag = String(Number(current?.etag || 0) + 1);
    this.files.set(k, { data: Buffer.from(b), etag });
    return etag;
  }
  async list(prefix: string) {
    return [...this.files.keys()].filter(
      (k) =>
        k.startsWith(prefix + "/") && !k.slice(prefix.length + 1).includes("/"),
    );
  }
}
export const host = {
  id: "host-a",
  name: "Host A",
  email: "host@example.com",
  role: "host" as const,
};
export const attendee = {
  id: "person-a",
  name: "Person A",
  email: "person@example.com",
  role: "attendee" as const,
};
