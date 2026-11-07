import type { Participant, TaskId } from "@/lib/types";
type State = {
  uploadId: string;
  uploadUrl?: string;
  offset: number;
  committed: boolean;
  deadline?: string;
};
export const DIRECT_CHUNK_BYTES = 10 * 320 * 1024;
export async function directEvidenceUpload(
  base: string,
  file: File,
  task: TaskId,
  progress: (text: string) => void,
  fetcher: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<Participant> {
  const request = async <T>(action: string, data: unknown): Promise<T> => {
    const r = await fetcher(base + "/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "same-origin",
      cache: "no-store",
    });
    const result = await r.json();
    if (!r.ok)
      throw new Error(
        result.error ||
          "Upload could not be saved. Select the same file to resume.",
      );
    return result;
  };
  progress("Checking file and preparing secure upload…");
  const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    ),
    sha256 = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const state = await request<State>("upload-start", {
    task,
    name: file.name,
    size: file.size,
    sha256,
  });
  let offset = state.offset,
    committed = state.committed;
  if (!committed) {
    const url = new URL(state.uploadUrl || "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      ![".sharepoint.com", ".1drv.com", ".onedrive.com"].some((h) =>
        url.hostname.endsWith(h),
      )
    )
      throw new Error("Invalid Microsoft upload address");
    let failures = 0,
      steps = 0;
    while (
      !committed &&
      steps++ < Math.ceil(file.size / DIRECT_CHUNK_BYTES) * 4 + 12
    ) {
      // This small JSON call rechecks sign-in, ownership and the server deadline before each chunk.
      const current = await request<State>("upload-status", {
        uploadId: state.uploadId,
      });
      if (current.committed) {
        committed = true;
        break;
      }
      offset = current.offset;
      if (!Number.isInteger(offset) || offset < 0 || offset >= file.size)
        throw new Error(
          "Upload offset is invalid. Select the same file again.",
        );
      progress(
        `Uploading directly to SharePoint · ${Math.floor((offset / file.size) * 100)}%`,
      );
      let response: Response;
      try {
        response = await fetcher(url.href, {
          method: "PUT",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: {
            "Content-Range": `bytes ${offset}-${Math.min(file.size, offset + DIRECT_CHUNK_BYTES) - 1}/${file.size}`,
          },
          body: file.slice(
            offset,
            Math.min(file.size, offset + DIRECT_CHUNK_BYTES),
          ),
          signal: AbortSignal.timeout(60000),
        });
      } catch {
        if (++failures > 4)
          throw new Error(
            "Connection interrupted. Select the same file to resume from SharePoint’s saved position.",
          );
        await sleep(300 * 2 ** failures);
        continue;
      }
      if (response.status === 200 || response.status === 201) {
        committed = true;
        break;
      }
      if (response.status === 202) {
        failures = 0;
        continue;
      }
      if (response.status === 416) {
        if (++failures > 4)
          throw new Error(
            "Upload position changed repeatedly. Select the same file to resume.",
          );
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get("Retry-After");
        const delay = retry
          ? /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Math.max(0, Date.parse(retry) - Date.now())
          : 500 * 2 ** failures;
        if (++failures > 4 || !Number.isFinite(delay) || delay > 20000)
          throw new Error(
            "SharePoint is busy. Select the same file to resume shortly.",
          );
        await sleep(delay);
        continue;
      }
      throw new Error(
        "Upload session unavailable. Select the same file to restart safely.",
      );
    }
  }
  if (!committed)
    throw new Error("Upload did not complete. Select the same file to resume.");
  progress("Verifying file size, checksum and assessment deadline…");
  const result = await request<{ participant: Participant }>(
    "upload-complete",
    { uploadId: state.uploadId },
  );
  progress("Evidence saved securely");
  return result.participant;
}
