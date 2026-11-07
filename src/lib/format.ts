export function format(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined
    ? "—"
    : `${Math.round(value * 10) / 10}${suffix}`;
}
