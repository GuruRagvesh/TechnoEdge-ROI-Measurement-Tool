export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
export function mockAuth() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.MOCK_AUTH === "true" &&
    process.env.STORAGE_ADAPTER !== "graph"
  );
}
// Single-round is the release default. ASSESSMENT_MODE=paired restores Base Camp + Summit creation.
export function assessmentMode(): "single" | "paired" {
  return process.env.ASSESSMENT_MODE === "paired" ? "paired" : "single";
}
export const MATERIAL_VERSION = "base-camp-pack-v1";
export const ANSWER_KEY_VERSION = "base-camp-keys-v1";
export function appUrl() {
  return new URL(process.env.APP_URL || "http://127.0.0.1:3000");
}
export function localTestAccountsEnabled() {
  const url = appUrl();
  return (
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_TEST_ACCOUNTS === "true" &&
    process.env.STORAGE_ADAPTER === "local" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
export function localTestRequestAllowed(url: URL, host: string | null) {
  return (
    localTestAccountsEnabled() &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.protocol === appUrl().protocol &&
    url.port === appUrl().port &&
    host === appUrl().host
  );
}
export function validateConfig() {
  // Every real Graph runtime is site-bound, including development against a live tenant.
  if (process.env.STORAGE_ADAPTER === "graph") validateGraphScope();
  if (process.env.NODE_ENV === "production") {
    if (
      process.env.MOCK_AUTH === "true" ||
      process.env.STORAGE_ADAPTER !== "graph"
    )
      throw new Error(
        "Production requires Graph storage and real authentication",
      );
    if (appUrl().protocol !== "https:")
      throw new Error("Production requires HTTPS APP_URL");
    [
      "GRAPH_TENANT_ID",
      "GRAPH_CLIENT_ID",
      "GRAPH_CLIENT_SECRET",
      "GRAPH_DRIVE_ID",
      "GRAPH_SITE_ID",
      "GRAPH_SITE_URL",
      "GRAPH_STORAGE_ROOT",
      "EMAIL_FROM",
      "IDENTITY_PEPPER",
    ].forEach(required);
    if (process.env.MAIL_PROVIDER === "resend") required("RESEND_API_KEY");
    else if (process.env.MAIL_PROVIDER === "smtp")
      ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"].forEach(required);
    else throw new Error("Select the approved production email provider");
    if (
      process.env.LOCAL_TEST_ACCOUNTS !== "false" ||
      process.env.MOCK_AUTH !== "false"
    )
      throw new Error(
        "Explicitly disable local credentials and mock email in production",
      );
    const secret = required("IDENTITY_PEPPER");
    if (
      secret.length < 32 ||
      /replace-with|local-development|test-only/i.test(secret)
    )
      throw new Error(
        "Production requires a strong non-template identity pepper",
      );
  }
}

function validateGraphScope() {
  [
    "GRAPH_TENANT_ID",
    "GRAPH_CLIENT_ID",
    "GRAPH_CLIENT_SECRET",
    "GRAPH_DRIVE_ID",
    "GRAPH_SITE_ID",
    "GRAPH_SITE_URL",
    "GRAPH_STORAGE_ROOT",
  ].forEach(required);
  const site = new URL(required("GRAPH_SITE_URL"));
  if (
    site.protocol !== "https:" ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    !site.hostname.endsWith(".sharepoint.com") ||
    site.hostname.endsWith("-my.sharepoint.com") ||
    !/^\/(sites|teams)\/[A-Za-z0-9_-]+\/?$/.test(site.pathname)
  )
    throw new Error("An approved dedicated SharePoint site URL is required");
  if (
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(
      required("GRAPH_STORAGE_ROOT"),
    )
  )
    throw new Error("An explicit application storage root is required");
  if (process.env.GRAPH_LAYOUT !== "cohorts-v1")
    throw new Error(
      "Real Graph storage requires cohorts-v1; migrate existing data explicitly",
    );
}

export function evidenceLimitMB() {
  const value = Number(process.env.EVIDENCE_MAX_MIB || 25);
  if (!Number.isInteger(value) || value < 1 || value > 250)
    throw new Error("EVIDENCE_MAX_MIB must be an integer from 1 to 250");
  return value;
}
