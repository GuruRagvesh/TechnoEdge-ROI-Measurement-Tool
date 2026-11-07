# Operations and recovery

## Saved work and conflicts

The participant JSON document is authoritative. An ETag protects each atomic document change; the attendee's numeric revision additionally rejects saves from stale browser tabs. A conflict leaves the browser's unsaved draft visible and asks the attendee to reload the saved version. They should copy unsaved method notes before discarding a draft. The app does not silently replay a stale full-document draft over another tab's work.

Save failures show a retry control. Submission flushes the current draft before locking. The service treats repeated and concurrent submission requests as the same submission, including a request retried after an uncertain response. A deadline submission includes only work committed before the cutoff.

The local adapter writes a temporary file, renames atomically and uses `proper-lockfile` with heartbeat renewal. A crashed lock becomes recoverable after the 30-second stale period. Do not delete a lock owned by a live process. Local directories are development fixtures; use the Graph adapter for production.

## Room recovery

Use the room ID from its SharePoint folder, not an attendee name:

```sh
npm run recover -- --room=ROOM_ID
```

This CLI runs with the server's configured credentials and therefore belongs in an administrator environment. It rebuilds missing host/attendee room-index entries for the specified room, finalizes expired attempts and reports missing referenced evidence and unreferenced upload intents. It does not change submitted answers, delete orphaned files or attach late evidence.

If a JSON record is corrupt or accidentally changed, restore its previous version from SharePoint version history or your approved backup process while writes are paused. Restore related evidence and the stable identity pepper if recovering an entire deployment. Then run recovery and inspect a new Excel export. Cross-document changes are recoverable operations, not a database transaction.

An upload may leave a blob behind if its participant metadata cannot be committed. Retrying the identical content before the deadline reuses the blob and attaches metadata once. Unreferenced files after a deadline require operator review under retention policy; they are not silently accepted as on-time work.

## Scores and interpretation

MCQs are four per selected task, one point each. Practical dimensions each run from 0 to 5. The final total is `MCQ / 12 × 40 + practical / 45 × 60`, rounded to an integer. Practical results remain pending until all three selected tasks are graded. Edits retain prior grading events in the participant's `gradingHistory`.

Observed time is elapsed wall-clock time from start to submission, including breaks, capped at the deadline. A matched pair requires the same stable identity, same three categories, submitted rounds all three tasks completed in both rounds and all six task evaluations. Post room creation enforces the same batch and duration as the linked baseline. Negative time or score improvements remain visible. Incomplete or ungraded pairs do not enter modeled ROI.

The financial model is capacity value, not realized cash savings: `paired minutes saved / 60 × cycles per year × hourly cost × adoption`. Net value subtracts investment; ROI divides net by investment only when investment is positive. Frequency, cost and adoption are assumptions. The application does not establish that AI caused the change.

## Evidence and data limits

Evidence accepts nonempty files up to `EVIDENCE_MAX_MIB` (default 25 MiB) and at most 15 evidence receipts/reserved upload slots per assessment. Graph uploads use direct resumable Microsoft sessions; local storage uses multipart. File extensions are allowlisted, Office/PDF signatures checked, filenames sanitized, and checksums verified before attachment. Archive plans split source files into 100 MiB parts. Provider capabilities can outlive an app deadline while late attachment is blocked; review quota and safe retention/cleanup for abandoned files. There is no local antivirus engine. Configure company SharePoint malware and evidence-handling policies before admitting untrusted files. Never automatically execute or enable macros from submitted documents. See [current boundaries](PHASE2_STAGING_READINESS.md).

Authentication state, codes, rate counters and session revocation are durable JSON documents, not process memory. Attendees enter through verified email plus a room code; a room code is an invitation mechanism, not a roster allowlist. Do not distribute a room code beyond its intended cohort. Stronger admission policies can be added at the room join boundary if required.
