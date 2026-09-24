// Video generation handler — CodeBuddy Global (Seedance).
//
// POST /v1/videos/generations
// Request:  { model: "cb/seedance-2.5", prompt, seconds?, resolution?, aspect_ratio?, audio?, negative_prompt? }
// Response: { id, task_id, status: "queued", ... }  — poll /v1/videos/:id
//
// Wire: POST https://www.codebuddy.ai/v2/videos/generations
// Poll: POST https://www.codebuddy.ai/v2/videos/tasks  { task_id }

import { randomUUID } from "crypto";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getAccessToken } from "../services/tokenRefresh.js";
import { createVideoJob, updateVideoJob, getVideoJobByTaskId } from "@/lib/db/repos/videoJobsRepo.js";
import { jwtSub } from "../utils/jwtSub.js";

const SUBMIT_URL = "https://www.codebuddy.ai/v2/videos/generations";
const POLL_URL = "https://www.codebuddy.ai/v2/videos/tasks";
const CLIENT_VERSION = "2.151.0";
const USER_AGENT = `CLI/${CLIENT_VERSION} CodeBuddy/${CLIENT_VERSION}`;
const MODEL_PREFIX = "cb/";

function stripAlias(model) {
  return typeof model === "string" && model.startsWith(MODEL_PREFIX)
    ? model.slice(MODEL_PREFIX.length)
    : model;
}

function buildVideoHeaders(bearer, uid) {
  const requestId = randomUUID().replace(/-/g, "");
  const conversationId = randomUUID();
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Authorization: `Bearer ${bearer}`,
    "X-Conversation-ID": conversationId,
    "X-Conversation-Request-ID": requestId,
    "X-Conversation-Message-ID": requestId,
    "X-Request-ID": requestId,
    "X-Agent-Intent": "craft",
    "X-Agent-Type": "main",
    "X-Agent-Purpose": "conversation",
    "X-Root-Request-ID": requestId,
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "",
    "X-IDE-Version": "0.0.0",
    "X-User-Id": uid,
    "X-Domain": "www.codebuddy.ai",
    "X-Product": "SaaS",
    "User-Agent": USER_AGENT,
  };
}

async function listCbCredentials(log) {
  const conns = (await getProviderConnections({ provider: "codebuddy" }))
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));

  const out = [];
  for (const conn of conns) {
    let token = conn.apiKey || conn.accessToken || null;
    if (!token && conn.refreshToken) {
      try {
        const refreshed = await getAccessToken("codebuddy-cn", { refreshToken: conn.refreshToken }, log);
        if (refreshed?.accessToken) token = refreshed.accessToken;
      } catch {}
    }
    if (token) out.push({ conn, token });
  }
  return out;
}

async function pickCredential(log) {
  const list = await listCbCredentials(log);
  return list[0] || { conn: null, token: null };
}

// Submit a new video job.
export async function submitVideoJob(body, options = {}) {
  const log = options.log || null;
  const modelRaw = typeof body?.model === "string" ? body.model : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const seconds = Number.isFinite(Number(body?.seconds)) ? Math.min(30, Math.max(4, Number(body.seconds))) : 4;
  if (!modelRaw || !prompt) {
    return {
      status: 400,
      json: { error: { message: "Missing 'model' or 'prompt'", type: "invalid_request_error" } },
    };
  }

  const creds = await listCbCredentials(log);
  if (creds.length === 0) {
    return {
      status: 401,
      json: { error: { message: "No active CodeBuddy Global connection", type: "authentication_error" } },
    };
  }

  const upstreamBody = {
    prompt,
    model: stripAlias(modelRaw),
    seconds,
    negative_prompt: typeof body?.negative_prompt === "string" ? body.negative_prompt : "",
    watermark: body?.watermark === false ? false : true,
    extra_parameters: {
      resolution: body?.resolution || "720P",
      enable_audio: body?.audio === true,
      aspect_ratio: body?.aspect_ratio || "16:9",
    },
  };

  // Try each credential until one has credits. Rotate on 14018 (credits
  // exhausted) or 14019 (rate-limited) — every other upstream error is
  // returned as-is on the first attempt.
  let response, text, outer, conn, token;
  let lastError = null;
  for (const cred of creds) {
    conn = cred.conn;
    token = cred.token;
    const uid = jwtSub(token);
    try {
      response = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: buildVideoHeaders(token, uid),
        body: JSON.stringify(upstreamBody),
      });
    } catch (error) {
      lastError = { status: 502, msg: `Upstream request failed: ${error.message}` };
      continue;
    }
    text = await response.text().catch(() => "");
    try { outer = JSON.parse(text); } catch {
      lastError = { status: 502, msg: `Video submit not JSON: ${text.slice(0, 200)}` };
      continue;
    }

    // Success shape: { code: 0, data: { id, status } }
    if (outer.code === 0 && outer.data?.id) break;

    // Two known transient / per-account errors — rotate to next credential.
    // Everything else is a real submission error: bail immediately.
    const errCode = outer?.error?.data?.code ?? outer?.code;
    const errMsg = outer?.error?.data?.msg ?? outer?.msg ?? "unknown";
    lastError = { status: response.status || 502, msg: errMsg, code: errCode, upstream: outer };
    const rotatable = errCode === 14018 || errCode === 14019;
    if (!rotatable) break;
  }

  if (!outer || outer.code !== 0 || !outer.data?.id) {
    return {
      status: lastError?.status || 502,
      json: {
        error: {
          message: `Video submit failed: code=${lastError?.code ?? "undefined"}, msg=${lastError?.msg || "unknown"}`,
          type: "upstream_error",
        },
        upstream: lastError?.upstream,
      },
    };
  }

  const taskId = String(outer.data.id);
  const upstreamStatus = outer.data.status || "queued";

  const job = await createVideoJob({
    taskId,
    provider: "codebuddy",
    connectionId: conn.id,
    model: modelRaw,
    prompt,
    status: upstreamStatus,
    seconds,
  });

  return {
    status: 200,
    json: {
      id: job.id,
      task_id: taskId,
      status: upstreamStatus,
      model: modelRaw,
      created: Math.floor(Date.now() / 1000),
    },
  };
}

// Poll an already-submitted taskId. Persists status transitions.
// Credential strategy: try the submitting connection first (some upstream
// task_id lookups are scoped to the account that created them), then rotate
// through the rest on rotatable errors (14018 credits exhausted, 14019 rate
// limit). Non-rotatable errors mark the job failed as before.
export async function pollVideoJob(taskId, options = {}) {
  const log = options.log || null;
  const existing = await getVideoJobByTaskId(taskId);
  if (!existing) return { status: 404, json: { error: { message: "Job not found" } } };

  if (existing.status === "completed" || existing.status === "failed") {
    return { status: 200, json: existing };
  }

  const creds = await listCbCredentials(log);
  if (creds.length === 0) return { status: 200, json: existing };

  const ordered = existing.connectionId
    ? [
        ...creds.filter((c) => c.conn.id === existing.connectionId),
        ...creds.filter((c) => c.conn.id !== existing.connectionId),
      ]
    : creds;

  let response, text, outer;
  for (const cred of ordered) {
    const uid = jwtSub(cred.token);
    try {
      response = await fetch(POLL_URL, {
        method: "POST",
        headers: buildVideoHeaders(cred.token, uid),
        body: JSON.stringify({ task_id: taskId }),
      });
    } catch {
      continue;
    }
    text = await response.text().catch(() => "");
    try { outer = JSON.parse(text); } catch {
      outer = null;
      continue;
    }
    if (outer.code === 0) break;

    const errCode = outer?.error?.data?.code ?? outer?.code;
    const errMsg = outer?.error?.data?.msg ?? outer?.msg ?? "unknown";
    const rotatable = errCode === 14018 || errCode === 14019;
    if (!rotatable) {
      await updateVideoJob(existing.id, {
        status: "failed",
        errorMessage: `poll code=${errCode} msg=${errMsg}`,
      });
      return { status: 200, json: await getVideoJobByTaskId(taskId) };
    }
  }

  if (!outer || outer.code !== 0) {
    // All credentials exhausted / rate-limited. Leave job in its current
    // pending state — the next poll can retry once credit refreshes.
    return { status: 200, json: existing };
  }

  const raw = outer.data?.status || "queued";
  const nextStatus = raw === "completed" || raw === "failed" || raw === "in_progress" ? raw : "queued";

  const patch = { status: nextStatus };
  if (nextStatus === "completed") {
    const first = outer.data?.data?.[0];
    if (first?.url) patch.url = first.url;
    if (first?.resolution) patch.resolution = first.resolution;
    if (typeof outer.data?.usage?.credit === "number") patch.credit = outer.data.usage.credit;
    if (typeof outer.data?.usage?.output_tokens === "number") patch.outputTokens = outer.data.usage.output_tokens;
  }
  await updateVideoJob(existing.id, patch);
  return { status: 200, json: await getVideoJobByTaskId(taskId) };
}
