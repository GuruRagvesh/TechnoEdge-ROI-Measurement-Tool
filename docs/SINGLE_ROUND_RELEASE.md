# Single-round release (11 Nov 2026)

Status: **code complete and verified locally. NOT LIVE.** No hosted deployment, SharePoint
connection or real OTP email has been verified yet.

## What changed

`ASSESSMENT_MODE` (default `single`) makes every new room one 60-minute round:

- Host "Create room" makes one open room (Base Camp pack and its 20 keys). No Summit room.
- Attendee, join, test and host pages drop Pre/Post, comparison and modeled-ROI content.
- The shared "Open cohort" room is no longer listed or joinable; a host-issued room code is required.
- No-evidence policy: a selected challenge with no upload gets 0/8 practical at submit or expiry.
- Each answer records the server time it was last changed.
- Registration record keeps `createdAt`, `verifiedAt`, `lastLoginAt`.
- Excel export for single-round rooms: Participants, Question Answers, Challenge Results,
  Overall Results, Evidence Log, Data Dictionary. Totals show "Pending" until graded.
- A failed autosave retries automatically.

`ASSESSMENT_MODE=paired` restores Base Camp + Summit creation. Existing paired rooms, records,
exports and the legacy 100-point scoring are untouched in either mode.

## Answer options (balanced-v2)

Rooms created from this release use `optionLayout: balanced-v2`. Every correct value is unchanged.
Distractors are seeded per question at independent 4-16% gaps, rounded to the answer's precision,
and options are shown in ascending order, so the correct position varies (A/B/C/D = 10/9/10/11
over the 40 questions; no task uses one position more than twice). Rooms created earlier have no
`optionLayout` and keep the original sequential order, so their saved answers still mark correctly.
The Excel export and host answer key state which layout a room uses.

## Protected Vercel staging

`vercel.json` disables deployments of `main` and skips every build except the `staging` branch.
Staging is therefore a Preview deployment, which Vercel Authentication protects by default.
On the Hobby plan the production address is never protected, so nothing deploys to production.

1. Import the repository in Vercel (project name `technoedge-assessment`).
2. Settings → Deployment Protection: confirm Vercel Authentication is on.
3. Push the `staging` branch; note its stable branch address
   (`technoedge-assessment-git-staging-<scope>.vercel.app`).
4. Settings → Environment Variables, environment **Preview**, branch `staging`: set every
   variable in `.env.staging.example`. `APP_URL` is the branch address from step 3.
   Secrets (`GRAPH_CLIENT_SECRET`, `RESEND_API_KEY`, `IDENTITY_PEPPER`) are typed in by the owner.
5. Redeploy `staging` and open `/api/health`.

The build runs typecheck, unit tests, materials verification and `next build`. Tests ignore
deployment variables, so the real settings never leak into them.

## Go-live steps (all need account owners)

1. Push this branch; let GitHub Actions run.
2. Microsoft 365: confirm the assessment site and `Assessment Records` library; confirm the
   Entra app, `Sites.Selected` consent and the site-scoped write grant; create a client secret.
3. Resend: verify the sender domain (DNS) and create an API key.
4. Vercel project, access-protected, with these variables:
   `APP_URL`, `STORAGE_ADAPTER=graph`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`,
   `GRAPH_CLIENT_SECRET`, `GRAPH_SITE_URL`, `GRAPH_SITE_ID`, `GRAPH_DRIVE_ID`,
   `GRAPH_STORAGE_ROOT`, `GRAPH_LAYOUT=cohorts-v1`, `MAIL_PROVIDER=resend`, `RESEND_API_KEY`,
   `EMAIL_FROM`, `IDENTITY_PEPPER` (32+ random characters), `MOCK_AUTH=false`,
   `LOCAL_TEST_ACCOUNTS=false`, `ASSESSMENT_MODE=single`.
5. `npm run infrastructure:check`, `npm run storage:probe`, `npm run email:probe`.
6. `npm run hosts -- add <host email>` against the live storage.
7. `/api/health` must return ready; then run one host + two participants end to end.
