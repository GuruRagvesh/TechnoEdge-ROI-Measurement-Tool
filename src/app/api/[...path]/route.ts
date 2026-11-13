import {
  createEvidenceArchivePlan,
  readEvidenceArchivePart,
} from "@/lib/evidence-archives";
import type { EvidenceSnapshot } from "@/lib/reports";
import { NextRequest, NextResponse } from "next/server";
import { requestEvent, reportError } from "@/lib/observability";
import { z } from "zod";
import { createHash } from "node:crypto";
import { AssessmentService, comparison, metrics } from "@/lib/assessment";
import { ResumableEvidence } from "@/lib/resumable-evidence";
import { batchSummary } from "@/lib/batches";
import {
  createSession,
  logout,
  requestCode,
  session,
  verifyCode,
} from "@/lib/auth";
import { evidenceLimitMB } from "@/lib/config";
import {
  appUrl,
  assessmentMode,
  mockAuth,
  localTestRequestAllowed,
} from "@/lib/config";
import { LocalTestStorage } from "@/lib/local-test-storage";
import { authenticateLocalTest } from "@/lib/local-test-auth";
import { layoutOf, publicTasks } from "@/lib/challenges";
import { keyWorkbook, materials } from "@/lib/materials";
import { evidenceZip, excelReport } from "@/lib/reports";
import { GraphStorage, getJson, storage } from "@/lib/storage";
import { graphMetrics, newGraphMetrics } from "@/lib/request-metrics";
import {
  AppError,
  TASK_IDS,
  type Identity,
  type Participant,
  type TaskId,
} from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const task = z.enum(TASK_IDS),
  id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  email = z.email().max(254);
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function bytes(req: NextRequest, max: number) {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new AppError(413, "Request too large");
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "Request too large");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
async function body(req: NextRequest) {
  return JSON.parse((await bytes(req, 150000)).toString("utf8"));
}
function download(data: Buffer, name: string, type: string) {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function route(req: NextRequest) {
  const segments = req.nextUrl.pathname.slice(5).split("/");
  const [resource, roomId, action, target] = segments;
  const method = req.method;
  if (
    resource === "preview" ||
    (resource === "auth" && roomId === "development-host")
  )
    throw new AppError(404, "Not found");
  if (
    resource === "auth" &&
    roomId === "test-login" &&
    !localTestRequestAllowed(new URL(req.url), req.headers.get("host"))
  )
    throw new AppError(404, "Not found");
  if (method !== "GET") {
    const origin = req.headers.get("origin");
    if (origin !== appUrl().origin)
      throw new AppError(403, "Untrusted request origin");
  }
  const base = storage();
  if (resource === "auth" && roomId === "test-login" && method === "POST") {
    const input = z
      .object({
        userId: z.enum(["DEMO001", "HOST001"]),
        password: z.string().min(1).max(256),
      })
      .parse(await body(req));
    const identity = await authenticateLocalTest(
      base,
      input.userId,
      input.password,
    );
    await createSession(identity);
    return json({ identity, destination: "/" + identity.role });
  }
  const current = await session();
  const s = current?.testAccount
    ? new LocalTestStorage(base, current.testGeneration!)
    : base;
  const service = new AssessmentService(s);
  if (resource === "auth") {
    if (roomId === "me")
      return json({
        identity: current,
        assessmentMode: assessmentMode(),
        localAccountsAvailable: localTestRequestAllowed(
          new URL(req.url),
          req.headers.get("host"),
        ),
      });
    if (roomId === "request-code" && method === "POST") {
      const input = z
        .object({ name: z.string().trim().min(2).max(100), email })
        .strict()
        .parse(await body(req));
      return json(
        await requestCode(
          input.name,
          input.email,
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct",
        ),
      );
    }
    if (roomId === "verify-code" && method === "POST") {
      const input = z
        .object({ challengeId: id, code: z.string().regex(/^\d{6}$/) })
        .parse(await body(req));
      return json(await verifyCode(input.challengeId, input.code));
    }
    if (roomId === "logout" && method === "POST") {
      await logout();
      return json({ ok: true });
    }
    if (roomId === "microsoft")
      throw new AppError(404, "Use email verification to sign in.");
    if (roomId === "development-mail" && method === "GET" && mockAuth()) {
      const challenge = id.parse(req.nextUrl.searchParams.get("challenge"));
      const mail = await getJson(base, `dev-mail/${challenge}.json`);
      return json(mail);
    }
    throw new AppError(404, "Not found");
  }
  // The session read at the top of the request is reused for every role
  // check below, instead of re-reading the session and host list from
  // SharePoint for each check.
  if (!current) throw new AppError(401, "Please sign in to continue.");
  const identity = current;
  const requireRole = (role: Identity["role"]) => {
    if (identity.role !== role)
      throw new AppError(403, "You do not have access to this portal.");
    return identity;
  };
  await service.defaultRoom();
  if (resource === "programs" && method === "POST") {
    requireRole("host");
    const input = z
      .object({
        company: z.string().trim().min(2).max(120),
        cohort: z.string().trim().min(2).max(80),
        requestId: z.string().uuid(),
      })
      .strict()
      .parse(await body(req));
    return json(
      {
        program: await service.createProgram(
          identity,
          input.company,
          input.cohort,
          input.requestId,
        ),
      },
      201,
    );
  }
  if (resource === "batches" && method === "GET") {
    requireRole("host");
    return json({ batches: await batchSummary(service, identity) });
  }
  if (resource === "rooms" && !roomId) {
    if (method === "GET") return json({ rooms: await service.rooms(identity) });
    if (method === "POST") {
      requireRole("host");
      throw new AppError(
        400,
        "Create a company assessment through the programs workflow. Assessment settings are fixed.",
      );
    }
  }
  if (resource === "dashboard" && method === "GET") {
    const rooms = await service.rooms(identity);
    const entries = [];
    for (const room of rooms) {
      const p =
        identity.role === "attendee"
          ? await service.participant(room.id, identity.id)
          : null;
      let paired = null;
      if (p && room.phase === "post" && room.preRoomId) {
        const pre = await service.participant(room.preRoomId, identity.id);
        if (pre) paired = comparison(pre, p);
      }
      entries.push({
        room,
        participant: p,
        metrics: p ? metrics(p) : null,
        comparison: paired,
      });
    }
    return json({ entries });
  }
  if (resource !== "rooms" || !roomId) throw new AppError(404, "Not found");
  id.parse(roomId);
  const room = await service.room(roomId);
  if (action === "validate" && method === "GET")
    return json({
      room: await service.validateJoin(roomId, requireRole("attendee")),
    });
  if (method === "GET" && !action) {
    const participant = await service.participant(roomId, identity.id);
    if (identity.role === "host") service.assertHost(room, identity);
    if (identity.role === "attendee" && !participant)
      throw new AppError(403, "Join this room first.");
    let preSelected: TaskId[] | null = null;
    if (room.phase === "post" && room.preRoomId && identity.role === "attendee")
      preSelected =
        (await service.participant(room.preRoomId, identity.id))?.selected ||
        null;
    return json({
      room,
      participant,
      tasks: publicTasks(room.phase, layoutOf(room)),
      preSelected,
      evidenceLimitMB: evidenceLimitMB(),
      uploadTransport:
        s instanceof GraphStorage ? "graph-direct" : "local-multipart",
      serverTime: new Date().toISOString(),
    });
  }
  if (action === "join" && method === "POST")
    return json({
      participant: await service.join(roomId, requireRole("attendee")),
    });
  if (
    [
      "upload-start",
      "upload-status",
      "upload-complete",
      "upload-cancel",
    ].includes(action) &&
    method === "POST"
  ) {
    requireRole("attendee");
    if (!(s instanceof GraphStorage))
      throw new AppError(
        400,
        "Direct upload sessions require SharePoint storage",
      );
    const uploads = new ResumableEvidence(s, s);
    if (action === "upload-start") {
      const input = z
        .object({
          task,
          name: z.string().min(1).max(100),
          size: z
            .number()
            .int()
            .positive()
            .max(evidenceLimitMB() * 1024 * 1024),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(await body(req));
      GraphStorage.slowCalls.length = 0;
      const started = await uploads.begin(roomId, identity, input);
      const res = json(started);
      // Diagnostics only: slow storage step types and timings, no identifiers.
      if (GraphStorage.slowCalls.length)
        res.headers.set("X-Storage-Slow", GraphStorage.slowCalls.join("; "));
      return res;
    }
    const input = z
      .object({ uploadId: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(await body(req));
    if (action === "upload-status")
      return json(await uploads.status(roomId, identity, input.uploadId));
    if (action === "upload-cancel") {
      await uploads.cancel(roomId, identity, input.uploadId);
      return json({ ok: true });
    }
    return json({
      participant: await uploads.complete(roomId, identity, input.uploadId),
      serverTime: new Date().toISOString(),
    });
  }
  if (
    ["start", "save", "submit", "upload"].includes(action) &&
    method === "POST"
  ) {
    requireRole("attendee");
    let participant: Participant;
    if (action === "start") {
      const input = z
        .object({ selected: z.array(task).max(5).optional() })
        .parse(await body(req));
      participant = await service.start(
        roomId,
        identity.id,
        input.selected || [],
      );
    } else if (action === "save") {
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          answers: z.partialRecord(
            task,
            z.array(z.number().int().min(-1).max(3)).max(4),
          ),
          notes: z.partialRecord(task, z.string().max(5000)),
          completed: z.array(task).max(5),
        })
        .parse(await body(req));
      participant = await service.save(roomId, identity.id, input);
    } else if (action === "submit")
      participant = await service.submit(roomId, identity.id);
    else {
      if (s instanceof GraphStorage)
        throw new AppError(
          400,
          "Use the authorized resumable SharePoint upload flow",
        );
      const raw = await bytes(req, (evidenceLimitMB() * 1024 + 128) * 1024);
      const form = await new Response(new Uint8Array(raw), {
          headers: { "Content-Type": req.headers.get("content-type") || "" },
        }).formData(),
        file = form.get("file"),
        t = task.parse(form.get("task"));
      if (
        !(file instanceof File) ||
        file.size > evidenceLimitMB() * 1024 * 1024
      )
        throw new AppError(400, `Choose a file up to ${evidenceLimitMB()} MB.`);
      participant = await service.upload(
        roomId,
        identity.id,
        t,
        file.name,
        Buffer.from(await file.arrayBuffer()),
      );
    }
    return json({ participant, serverTime: new Date().toISOString() });
  }
  if (action === "materials" && method === "GET") {
    const t = task.parse(target);
    const p = await service.participant(roomId, identity.id);
    if (identity.role === "host") service.assertHost(room, identity);
    else if (!p?.startedAt || p.submittedAt || !p.selected.includes(t))
      throw new AppError(
        403,
        "Start your selected task before downloading materials.",
      );
    return download(
      await materials(
        t,
        room.phase,
        room.scoringVersion || "legacy-100",
        room.mode === "single",
      ),
      room.mode === "single" ? `${t}-materials.zip` : `${t}-${room.phase}.zip`,
      "application/zip",
    );
  }
  if (action === "evidence" && method === "GET") {
    const participantId = id.parse(req.nextUrl.searchParams.get("participant"));
    if (identity.role === "host") service.assertHost(room, identity);
    else if (participantId !== identity.id)
      throw new AppError(403, "Access denied");
    const p = await service.participant(roomId, participantId),
      e = p?.evidence.find((x) => x.id === target);
    if (!e) throw new AppError(404, "Evidence not found");
    const blob = await s.read(e.path);
    if (
      !blob ||
      createHash("sha256").update(blob.data).digest("hex") !== e.sha256
    )
      throw new AppError(503, "Evidence unavailable or checksum mismatch");
    if (s instanceof GraphStorage)
      return json({ downloadUrl: await s.downloadLink(e.path), name: e.name });
    return download(blob.data, e.name, "application/octet-stream");
  }
  requireRole("host");
  service.assertHost(room, identity);
  if (action === "participants" && method === "GET")
    return json({
      room,
      participants: await service.attendees(roomId, identity),
      tasks: publicTasks(room.phase, layoutOf(room)),
    });
  if (action === "grade" && method === "POST") {
    const input = z
      .object({
        participantId: id,
        task,
        expectedAt: z.string().nullable(),
        quality: z.number().min(0).max(5),
        accuracy: z.number().min(0).max(5),
        completeness: z.number().min(0).max(5),
        feedback: z.string().trim().min(3).max(5000),
      })
      .parse(await body(req));
    return json({
      participant: await service.grade(
        roomId,
        input.participantId,
        input.task,
        identity,
        {
          accuracy: input.accuracy,
          quality: input.quality,
          completeness: input.completeness,
          feedback: input.feedback,
        },
        input.expectedAt,
      ),
    });
  }
  if (action === "close" && method === "POST") {
    const input = z.object({ closed: z.boolean() }).parse(await body(req));
    return json({ room: await service.close(roomId, identity, input.closed) });
  }
  if ((action === "export" || action === "evidence-zip") && method === "GET") {
    let snapshot: EvidenceSnapshot[] | undefined;
    if (action === "evidence-zip") {
      const planId = req.nextUrl.searchParams.get("plan");
      if (planId)
        snapshot = await readEvidenceArchivePart(
          service,
          room,
          identity,
          z.string().uuid().parse(planId),
          z.coerce
            .number()
            .int()
            .positive()
            .parse(req.nextUrl.searchParams.get("part")),
        );
      else {
        const plan = await createEvidenceArchivePlan(service, room, identity);
        if (plan.parts.length > 1)
          return json({
            parts: plan.parts.map((part, i) => ({
              label: `Evidence ZIP part ${i + 1} of ${plan.parts.length} (${Math.ceil(part.reduce((n, x) => n + x.e.size, 0) / 1024 / 1024)} MiB)`,
              href: `/api/rooms/${roomId}/evidence-zip?plan=${plan.id}&part=${i + 1}`,
            })),
          });
        snapshot = plan.parts[0];
      }
    }
    let artifact = "";
    const data =
      action === "export"
        ? await excelReport(service, room, identity, (key) => {
            artifact = key;
          })
        : await evidenceZip(
            service,
            room,
            identity,
            (key) => {
              artifact = key;
            },
            snapshot,
          );
    const name =
      (room.mode === "single"
        ? (room.company + "-" + room.batch).replace(/[^A-Za-z0-9_-]+/g, "_")
        : roomId) +
      (action === "export" ? "-assessment.xlsx" : "-evidence.zip");
    if (s instanceof GraphStorage)
      return json({ downloadUrl: await s.downloadLink(artifact), name });
    return download(
      data,
      name,
      action === "export"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/zip",
    );
  }
  if (action === "answer-key" && method === "GET")
    return download(
      await keyWorkbook(room.phase, layoutOf(room)),
      `${roomId}-answer-key.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  if (action === "comparisons" && method === "GET") {
    const people = await service.attendees(roomId, identity);
    const pairs = [];
    if (room.phase === "post" && room.preRoomId)
      for (const post of people) {
        const pre = await service.participant(room.preRoomId, post.identity.id);
        if (pre)
          pairs.push({
            identity: post.identity,
            pre: metrics(pre),
            post: metrics(post),
            ...comparison(pre, post),
          });
      }
    return json({ pairs });
  }
  throw new AppError(404, "Not found");
}
async function handler(req: NextRequest) {
  const started = Date.now();
  const finish = async (response: Response, fault?: unknown) => {
    const segments = req.nextUrl.pathname.slice(5).split("/");
    const resource = segments[0] || "unknown";
    const action = segments[2] || "index";
    const event = requestEvent(
      resource +
        "/" +
        (resource === "auth" ? segments[1] || "unknown" : action),
      response.status,
      Date.now() - started,
      fault,
      metrics,
    );
    response.headers.set("X-Request-ID", event.requestId);
    if (response.status >= 500) await reportError(event);
    return response;
  };
  const metrics = newGraphMetrics();
  try {
    return await finish(await graphMetrics.run(metrics, () => route(req)));
  } catch (e) {
    if (e instanceof z.ZodError)
      return finish(
        json(
          {
            error: "Invalid input",
            details: e.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          },
          400,
        ),
      );
    if (e instanceof SyntaxError)
      return finish(json({ error: "Invalid JSON body" }, 400));
    if (e instanceof AppError)
      return finish(json({ error: e.message, code: e.code }, e.status), e);
    return finish(
      json(
        {
          error:
            "Service unavailable. Your previously saved work is safe. Please retry.",
        },
        503,
      ),
      e,
    );
  }
}
export { handler as GET, handler as POST };
