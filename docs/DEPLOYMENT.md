# Deployment

Deploy the application as a Node.js service or container behind HTTPS. The requested Next.js application uses a Node runtime for Office generation and secure server-side Graph access. A static hosting deployment cannot run these workflows.

Deployment is not currently authorized. Follow the [final administrator checklist](FINAL_ADMIN_CHECKLIST.md) and [current local readiness evidence](PHASE2_STAGING_READINESS.md) before executing deployment instructions.

## Build and run

```sh
npm ci
npm run typecheck
npm test
npm run materials:verify
npm run build
# Set the production environment from .env.example in the platform secret store.
PORT=3000 HOSTNAME=0.0.0.0 npm start
```

`npm start` runs the standalone production server. Production API requests fail closed when storage is not Graph, mock auth is enabled, required secrets are missing, the identity pepper is a template/weak value, or `APP_URL` is not HTTPS. Next's framework build can run without tenant credentials because private data is fetched at runtime.

If using the standalone Docker build:

```sh
docker build -t technoedge-assessment .
docker run --env-file /secure/path/production.env -p 3000:3000 technoedge-assessment
```

The Dockerfile uses a nonroot runtime user and the generated standalone Next server. Supply runtime secrets at deployment, never with Docker build arguments. The production environment file must not enter the source repository or build context. The checked-in Dockerfile has not been built in this Windows session; the Next production build has been tested directly.

## Ingress and operations

- Configure HTTPS and set `APP_URL` to the exact public origin. Forward the original host/protocol correctly. The origin comparison is intentionally strict for every state-changing request.
- Graph-mode uploads send file bytes directly from the browser to authorized Microsoft upload sessions; the app receives only JSON controls. Default `EVIDENCE_MAX_MIB=25`; no large-body override is assumed on Vercel. Local development retains multipart uploads. Configure timeouts/memory for bounded Graph retries, server-side checksum reads and report generation.
- Keep authentication, API and export responses uncached. Do not add a CDN cache rule for `/api/*` or identity-bearing responses.
- Apply ingress rate limiting to authentication and upload routes. Cookies are scoped to this application; do not host untrusted applications on the same origin.
- Require authentication or platform access restrictions around a staging instance. Never deploy with `next dev` or expose the mock mailbox publicly.
- Use secret management, credential rotation, log retention and SharePoint versioning/backups. Keep evidence available only to its attendee and authorized room owner. Apply a retention process to expired sessions, codes, upload intents and old evidence.
- The default room is shared among authorized hosts. Create host-owned cohort rooms for isolation between separate facilitators.
- Keep a consistent release across all instances. Clock synchronization is required. Local storage is for development, not horizontally scaled hosting; SharePoint CAS is the distributed concurrency boundary.

Run `npm run storage:probe` on the real library before rollout. Complete the Microsoft 365 acceptance steps in [setup](MICROSOFT_365_SETUP.md). Local tests do not certify tenant permissions, Microsoft service behavior, email delivery or production load capacity.

## Workload boundaries

Evidence archives are split into immutable parts of at most 100 MiB of source evidence. The lower-level builder retains a defensive 150 MiB cap. Reports and ZIP parts are generated in memory; Graph downloads use Microsoft preauthenticated links after authorization. Host views poll saved progress every 15 seconds and batch summaries refresh explicitly. Measure memory, duration, tenant latency and throttling before increasing cohort size or adding instances. This application has not been load-tested against SharePoint.

Deadline finalization is enforced on reads and writes, not by trusting the browser timer. Inactive attempts become logically locked at their deadline; the durable submission stamp is materialized on the next authorized read/write, host refresh, export or recovery run. If physically finalizing unattended records on a wall-clock schedule is required, run the recovery command from your deployment scheduler with the relevant room IDs.

Material code is deterministic and release-versioned. Do not change material definitions or answer keys during active cohorts. Pin the deployment until its rooms finish.
