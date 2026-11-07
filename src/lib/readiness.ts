type Check = {
  key: string;
  status: "configured-unverified" | "missing" | "invalid";
  required: boolean;
};
export function infrastructureReadiness(
  env: Record<string, string | undefined> = process.env,
) {
  const checks: Check[] = [];
  const add = (
    key: string,
    valid: (v: string) => boolean = () => true,
    required = true,
  ) => {
    const v = env[key]?.trim();
    checks.push({
      key,
      status: !v
        ? "missing"
        : /replace-with|<tenant>|your-domain|YOUR_|placeholder|example\.(com|test)/i.test(
              v,
            ) || !valid(v)
          ? "invalid"
          : "configured-unverified",
      required,
    });
  };
  const guid = (s: string) =>
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
  add("APP_URL", (s) => {
    try {
      const u = new URL(s);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        u.pathname === "/" &&
        !u.search &&
        !u.hash &&
        !/localhost|127\.0\.0\.1/.test(u.hostname)
      );
    } catch {
      return false;
    }
  });
  add("STORAGE_ADAPTER", (s) => s === "graph");
  add("MOCK_AUTH", (s) => s === "false");
  add("LOCAL_TEST_ACCOUNTS", (s) => s === "false");
  add("GRAPH_TENANT_ID", guid);
  add("GRAPH_CLIENT_ID", guid);
  add("GRAPH_CLIENT_SECRET");
  add("GRAPH_DRIVE_ID");
  add("GRAPH_SITE_URL", (s) => {
    try {
      const u = new URL(s);
      return (
        u.protocol === "https:" &&
        u.hostname.endsWith(".sharepoint.com") &&
        !u.hostname.endsWith("-my.sharepoint.com") &&
        /^\/(sites|teams)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
      );
    } catch {
      return false;
    }
  });
  add("GRAPH_SITE_ID", (s) => {
    const p = s.split(",");
    try {
      return (
        p.length === 3 &&
        p[0] === new URL(env.GRAPH_SITE_URL || "").hostname &&
        guid(p[1]) &&
        guid(p[2])
      );
    } catch {
      return false;
    }
  });
  add("GRAPH_STORAGE_ROOT", (s) =>
    /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(s),
  );
  add("GRAPH_LAYOUT", (s) => s === "cohorts-v1");
  add("MAIL_PROVIDER", (s) => ["resend", "smtp"].includes(s));
  if (env.MAIL_PROVIDER !== "smtp")
    add("RESEND_API_KEY", (s) => s.startsWith("re_"));
  else for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]) add(key);
  add("EMAIL_FROM", (s) =>
    /^[^\r\n]*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(s),
  );
  add(
    "IDENTITY_PEPPER",
    (s) => s.length >= 32 && !/local-development|test-only/.test(s),
  );
  add("VERCEL_PROJECT_ID", undefined, false);
  add("VERCEL_ORG_ID", undefined, false);
  add("VERCEL_TOKEN", undefined, false);
  add(
    "ERROR_MONITOR_URL",
    (s) => {
      try {
        return new URL(s).protocol === "https:";
      } catch {
        return false;
      }
    },
    false,
  );
  return {
    configurationReady: checks.every(
      (c) => !c.required || c.status === "configured-unverified",
    ),
    liveVerified: false,
    deploymentApproved: false,
    checks,
    manualGates: [
      "Microsoft administrator approval; site/library creation and Sites.Selected consent + site write grant",
      "Resend sender-domain verification, DNS and inbox-delivery checks",
      "Approved protected Vercel staging project, access policy and log/error alert ownership",
      "Live direct-upload CORS, 25 MiB resume/finalization, conditional-write and larger export verification",
      "20-participant live concurrency/recovery probe; real Pre/Post pilot with 2 internal users, then 10 participants, then a larger approved cohort",
    ],
  };
}
