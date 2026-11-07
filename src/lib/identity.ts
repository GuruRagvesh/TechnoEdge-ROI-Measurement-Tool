import { createHmac } from "node:crypto";
import { mockAuth, required } from "./config";
export function stableId(email: string) {
  const pepper =
    process.env.IDENTITY_PEPPER ||
    (mockAuth()
      ? "local-development-pepper-change-before-production"
      : required("IDENTITY_PEPPER"));
  return createHmac("sha256", pepper)
    .update(email.trim().toLowerCase())
    .digest("hex");
}
