# Microsoft 365 administrator setup — approval required

Status: proposed configuration only. No site, library, app registration, permission grant or company document was created or changed by this work. Do not execute provisioning until TechnoEdge approves it.

## Requested resources

| Resource | Proposed value |
| --- | --- |
| Organization | TechnoEdge Learning Services |
| Private company-owned SharePoint site | TechnoEdge Assessment ROI |
| Site URL | `https://<tenant>.sharepoint.com/sites/TechnoEdgeAssessmentROI` — administrator must confirm the actual tenant |
| Document library | Assessment Records |
| Runtime Entra application | TechnoEdge Assessment ROI Storage |
| Staging application root inside the library | `TechnoEdgeAssessmentROI/Staging` |
| Future production root | Separate approved library/site preferred; at minimum a distinct root, credential and environment |

The connected account has a personal OneDrive Business. That discovery is not approval to use it, and it is not a runtime application credential. The app now verifies that the configured drive is a `documentLibrary` belonging to the exact approved site before storage operations. Personal OneDrive is rejected for the proposed production configuration.

## Administrator procedure after approval

1. Create the dedicated private SharePoint site through the company administration process. Assign company owners and a backup owner, retention, version history and recovery responsibilities. Do not grant attendees direct library access or anonymous sharing.
2. Create the **Assessment Records** document library. Avoid required checkout and labels/policies that prevent app-only conditional updates. Check the intended evidence-file types against company malware and retention controls.
3. Register a single-tenant Entra application for application-only Microsoft Graph storage. Record its tenant GUID and application/client GUID. Issue a rotating server credential; the current implementation supports the client-secret value, not the secret's ID. Keep it exclusively in the approved secret store. Certificate/workload-identity authentication is not implemented in this release.
4. Add **Microsoft Graph application permission `Sites.Selected`** and grant administrator consent. Do not give the runtime application `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `Sites.FullControl.All`, delegated user credentials or mail permissions.
5. Use a separate administrator provisioning context to grant this runtime app **`write`** on this site only. `Sites.Selected` consent by itself grants no site access. The provisioning context needs the administrator authority documented by Microsoft; do not copy its broad permissions or credential into the assessment runtime.
6. Resolve the approved site's ID and list its libraries using the administrator context. Record the drive ID for **Assessment Records** specifically. Do not substitute the current user's `me/drive` ID or a URL for a drive ID.
7. Supply the approved identifiers/configuration below to the operator. Store credentials directly in Vercel's staging secret store; never send them through chat, checked-in files or browser JavaScript.

Read-only discovery requests, after approval:

```http
GET https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/TechnoEdgeAssessmentROI
GET https://graph.microsoft.com/v1.0/sites/<site-id>/drives
```

The site ID is the returned composite `hostname,siteCollectionGuid,webGuid`. The library's drive ID is the returned opaque `id`.

Administrator-only permission request for review (not executed):

```http
POST https://graph.microsoft.com/v1.0/sites/<site-id>/permissions
Content-Type: application/json

{
  "roles": ["write"],
  "grantedToIdentities": [{
    "application": {
      "id": "<runtime-application-client-id>",
      "displayName": "TechnoEdge Assessment ROI Storage"
    }
  }]
}
```

The Graph grant endpoint requires `Sites.FullControl.All` in the separate provisioning context; delegated use also requires appropriate administrator/site membership. The runtime app retains only its selected-site grant. See [Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview) and [Create site permission](https://learn.microsoft.com/en-us/graph/api/site-post-permissions?view=graph-rest-1.0).

## Configuration handoff

| Setting | Needed value |
| --- | --- |
| `GRAPH_TENANT_ID` | Actual tenant GUID |
| `GRAPH_CLIENT_ID` | Runtime application's client GUID |
| `GRAPH_CLIENT_SECRET` | Runtime credential value, supplied privately |
| `GRAPH_SITE_URL` | Approved exact HTTPS site URL |
| `GRAPH_SITE_ID` | Composite Graph site ID |
| `GRAPH_DRIVE_ID` | Assessment Records library drive ID |
| `GRAPH_STORAGE_ROOT` | `TechnoEdgeAssessmentROI/Staging` |
| `GRAPH_LAYOUT` | `cohorts-v1` |

The runtime uses OAuth client credentials and `https://graph.microsoft.com/.default`. It never asks attendees to authorize Graph, and never sends the app token to browser code or upload-session URLs.

## Expected physical layout

```text
Assessment Records/
  TechnoEdgeAssessmentROI/Staging/
    config/host-allowlist.json
    identities/
    auth/
    hosts/
    attendees/
    cohorts/<program-id>/
      program.json
      base-camp/
        room.json
        participants/<participant-id>.json
        evidence/<participant-id>/<content-addressed-file>
        upload-intents/
        resumable-intents/<participant-id>/<private-session-intent>.json
        reports/<immutable-workbook-or-archive>
      summit/
        room.json
        participants/<participant-id>.json
        evidence/
        upload-intents/
        resumable-intents/
        reports/
    probes/<probe-id>/
    rooms/<legacy-standalone-room-id>/
```

Company/cohort names live in `program.json`; opaque cohort folder IDs avoid unsafe paths and name collisions. Practical evaluations and their audit history are stored in each participant's individual JSON record. Logical room/evidence keys remain stable in APIs and exports. Existing local files are not moved or converted. If prior Graph data exists, plan an explicit backed-up layout migration; do not simply switch roots/layouts and assume it migrated.

## Acceptance gate after provisioning

First run the read-only target check. Only after administrator approval run the write probes in the dedicated staging root:

```powershell
npm run infrastructure:check -- --strict --live-readonly
npm run storage:probe -- --confirm-live
npm run storage:cohort-probe -- --confirm-live
```

The conditional-write probe must show exactly one winning writer and must reject a direct stale HTTP `If-Match` update at Microsoft's endpoint. If that test fails, stop rollout; an adapter-side metadata check alone does not prove atomicity. Never widen permissions or accept last-writer-wins as a workaround.

The cohort probe intentionally creates and retains synthetic records in the approved staging root. Review its 20-participant/40-attempt/120-file results and exports, then perform the separate real-person pilot: two internal users, then ten participants, then a larger approved cohort. Test actual near-25 MiB browser uploads and split archives as specified in the [final administrator checklist](FINAL_ADMIN_CHECKLIST.md). No probe writes were made to Microsoft 365 in this workspace.
