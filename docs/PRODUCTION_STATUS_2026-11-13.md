# Production status and data-provider approval

Date: 13 November 2026  
Application: TechnoEdge Assessment ROI  
Production: `https://technoedge-assessment.vercel.app`

## Decision

The project owner approved continued production use of the Vercel Marketplace
Supabase database in this Codex conversation on 13 November 2026.

The approval covers storing the application's live operational records, including
participant identity details, assessment answers, notes, grading data, room records,
sessions and email-code control records. Re-review is required before changing the
provider, database region, connected Vercel environment, data categories or retention
expectations.

## Verified production configuration

- Supabase resource: `technoedge-assessment-records`
- Vercel environment: Production only
- Primary region: Mumbai (`bom1`, South Asia)
- Plan at verification: Supabase Free Plan
- Application setting: `RECORD_STORE=postgres`
- Deployment: `75f61d9988a370e269e5f589541309bd033f00f1` (PR #20)
- Live health result: HTTP 200, `recordStore=postgres`, `database=ok`
- Landing page, login page and signed-out identity endpoint: HTTP 200
- Current source verification: typecheck passed; 128 tests passed and 8
  environment-dependent tests skipped; materials verification and production build
  passed
- Recent production runtime warnings/errors: none returned in the inspected 30-minute
  Vercel log window

Provider metadata and the application's health endpoint were checked through the
connected Vercel project on 13 November 2026. Secret values were not read or copied.

## Data placement

PostgreSQL holds JSON application records except `config/`: identities, verification
challenges and rate records, sessions, room and program indexes, rooms, participant
answers, notes, grading and autosave state.

SharePoint remains the system for:

- `config/host-allowlist.json`
- evidence files, exports and archives
- a copy of every submitted participant result
- pre-switch records that may be adopted into PostgreSQL on first use

The table `app_records` has row-level security enabled with no public policies. The
server connects over verified TLS; Supabase hosts are checked against the bundled
Supabase root certificate.

Supabase documents that the primary database and backups remain in the selected
region. Support, security response, account information and service telemetry may be
processed outside that region. Review the current
[data-residency information](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq)
and [Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum)
before any later expansion of the stored data.

## Host access

The current production allowlist contains:

- `guru.thanumoorthy@technoedgels.com`
- `pavan.lalwani@technoedgels.com`

The requested addition of `ai.technoedge@gmail.com` was explicitly cancelled and was
not applied. A complete production Host login remains pending because the available
operator cannot access either current Host mailbox. Pavan or another currently
allowlisted mailbox owner must complete the email-code sign-in and confirm that
`/host` opens.

The allowlist has versions 1.0, 2.0 and 3.0. The current version contains no Gmail
address. The connected SharePoint API exposed the older versions' dates and sizes but
not their file contents, so the historical “Gmail as Host” report remains unresolved.

## Synthetic records

No production records were deleted. Retained synthetic rooms should be reviewed from
the Host portal after Host access is verified. Close confirmed test rooms through the
normal room control. The application has no normal hard-delete room workflow, which
protects submitted results and audit evidence.

## Remaining production gates

- Complete one email-code login with a currently allowlisted Host and verify the Host
  portal.
- Inspect the contents of allowlist versions 1.0 and 2.0 from SharePoint's native
  Version history if the historical Gmail report still needs an answer.
- Review and close confirmed synthetic rooms from the Host portal.
- Run a small real-person pilot before treating the 100-user synthetic load result as
  a production capacity result.
- Keep `/api/health` at HTTP 200 with `database=ok`; database errors, lost records,
  authorization failures or failed Host access block further rollout.

## Rollback

If PostgreSQL must be removed, first run the existing trusted
`npm run records:to-sharepoint -- --confirm-live` operator command with the production
credentials. It copies live records and sessions back to SharePoint. Then switch the
record store to Graph and redeploy. Short-lived verification challenges and rate-limit
records are intentionally not copied.
