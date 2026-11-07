import { safeKey } from "./storage";
// Logical keys remain stable in records/exports; only new scoped Graph storage uses this layout.
export function storageLayout(
  key: string,
  layout = process.env.GRAPH_LAYOUT || "legacy",
) {
  safeKey(key);
  if (layout === "legacy") return key;
  if (layout !== "cohorts-v1") throw new Error("Unsupported Graph layout");
  const room = key.match(/^rooms\/([a-f0-9]{20})-(pre|post)(?:\/(.*))?$/);
  if (room)
    return `cohorts/${room[1]}/${room[2] === "pre" ? "base-camp" : "summit"}${room[3] ? "/" + room[3] : ""}`;
  const program = key.match(/^programs\/([a-f0-9]{20})(?:\/(.*))?$/);
  return program
    ? `cohorts/${program[1]}${program[2] ? "/" + program[2] : ""}`
    : key;
}
