# Microsoft Entra, SharePoint and email setup

This project is not currently connected to a live Microsoft 365 tenant. The following configuration must be completed by your Microsoft 365 administrator. Use a dedicated test site and library for acceptance tests before enrolling a cohort.

## 1. Unified email login and authorized hosts

Hosts and attendees use the same name/email/OTP form. No Microsoft host sign-in application, redirect URI, app role or OAuth client credential is required. Arbitrary valid email domains are accepted. Role is resolved only after OTP verification using the server-owned exact-email registry at 'config/host-allowlist.json'. An email domain or supplied name never grants Host permission.

Use a trusted operator shell with the application's backend configuration to provision staff:

```powershell
npm run hosts -- add authorized.staff@technoedge.example
npm run hosts -- remove authorized.staff@technoedge.example
```

There is no web endpoint for host registration. Every non-test session rechecks the registry, so removal takes effect on its next request. Restrict who can execute the administration CLI and write the SharePoint config folder. Existing host-owned rooms retain their owner IDs: former tenant/object-ID based host records need an explicit backed-up ownership migration to the email-derived ID before that host can manage them. The app never transfers ownership based on an unverified browser request.

## 2. Dedicated SharePoint storage application

Create an app registration for app-only Graph storage in the company tenant. Email login does not depend on the attendee’s identity provider.

1. Create a dedicated SharePoint site/library for assessment data. Enable version history, retention and backups appropriate to participant evidence. Do not give attendees direct library access. Authorized app access should be isolated from general staff document access.
2. Add the Graph application permission **Sites.Selected**, grant admin consent, and explicitly grant this app the `write` role on the dedicated site using your administrator provisioning process. Selected permissions need both consent and a resource assignment. Validate that your tenant permits the required upload-session and conditional content operations with that scoped permission. Do not silently widen permissions if a probe fails.
3. Set `GRAPH_CLIENT_ID` and `GRAPH_CLIENT_SECRET` in the server secret store. This implementation uses app-only OAuth client credentials with scope `https://graph.microsoft.com/.default`.
4. As an administrator, resolve the site with `GET https://graph.microsoft.com/v1.0/sites/YOUR_HOSTNAME:/sites/YOUR_SITE_PATH`, then list libraries with `GET /sites/{site-id}/drives`. Select the dedicated library and set its ID in `GRAPH_DRIVE_ID`.
5. The application creates its own `rooms`, `programs`, `identities`, `config`, `auth`, `attendees`, `hosts` and `probes` folders at that drive's root. No preexisting workbook is required. Library checkout requirements, sensitivity labels or policies that prevent app-only file updates must be resolved before use.
6. With `STORAGE_ADAPTER=graph`, `MOCK_AUTH=false` and the server configuration present, run `npm run storage:probe`. It leaves a harmless isolated probe JSON document under `probes/<uuid>/`. Require a passing race/precondition test before production. If `If-Match` is not enforced by your tenant's endpoint, stop rollout and correct the storage strategy; do not accept last-writer-wins updates.

Application folder access is not an authorization boundary by itself. Runtime authorization checks room ownership and participant identity before loading or changing records. The default `ai-productivity-pre` room is intentionally shared among all assigned hosts; additional rooms belong to their creator.

## 3. Host and attendee email verification

Configure an authenticated TLS SMTP relay:

```dotenv
SMTP_HOST=your-approved-relay
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-secret
EMAIL_FROM=TechnoEdge Assessments <assessments@your-domain>
EMAIL_HOURLY_LIMIT=200
```

Use an approved sending domain with SPF/DKIM/DMARC configured. Microsoft 365 tenants often disable SMTP AUTH; use an approved relay if your tenant does not allow username/password SMTP. This application does not assume basic SMTP authentication is enabled on an Exchange Online mailbox. No production email is sent through the connected chat account.

Codes expire in 10 minutes, allow at most five attempts and are consumed once with conditional writes. Issuance is limited per normalized email (six per hour, minimum 30 seconds apart) plus a global hourly cap. The global cap is a service guard and can be exhausted; configure ingress rate limiting for a public deployment. Unknown identities are not queried in a public attendee directory. SMTP delivery failures return an actionable service failure without creating a browser session.

## 4. Final runtime settings

```dotenv
APP_URL=https://YOUR_DOMAIN
STORAGE_ADAPTER=graph
MOCK_AUTH=false
IDENTITY_PEPPER=<random stable secret of at least 32 characters>
```

Keep `IDENTITY_PEPPER` stable, backed up and confidential. It keys normalized attendee email identities; replacing it without a controlled migration breaks Pre/Post identity links. Sessions store only a hash of the random browser token. Cookies are HttpOnly, SameSite=Lax and Secure for the HTTPS origin; sessions last 12 hours and can be revoked on logout.

## 5. Tenant acceptance tests

- A registered staff email receives a real OTP and enters Host; an unregistered address remains Attendee. Removing staff from the registry revokes host access on the next request.
- Attendee receives a real email, verifies once, logs out and signs back in using the same email; saved assessment reappears.
- Validate a room without creating an attempt. Explicitly confirm joining; verify the timer starts before selecting three tasks. Save, upload a real Office document, reload from another device and resume the same deadline.
- Create a company/cohort program with two rooms. Verify Summit is initially closed; open it and confirm the same three categories are inherited with different source data.
- Grade all selected tasks, download a valid XLSX and evidence ZIP, and confirm the new report exists in SharePoint.
- Run the storage race/precondition probe and test throttling handling in the test environment.
- Restore a test participant's prior SharePoint version and run the recovery command for its room.

These tenant-dependent steps are not covered by the local mock results. Do not describe them as tested until they are exercised with your configuration.

Official references: [Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0), [Graph throttling](https://learn.microsoft.com/en-us/graph/throttling), [Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).

