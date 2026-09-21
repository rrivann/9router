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

function jwtSub(token) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return "";
  try {
    const buf = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const payload = JSON.parse(buf.toString());
    return payload?.sub || "";
  } catch {
    return "";
  }
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

async function pickCredential(log) {
  const conns = (await getProviderConnections({ provider: "codebuddy" }))
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));

  for (const conn of conns) {
    let token = conn.apiKey || conn.accessToken || null;
    if (!token && conn.refreshToken) {
      try {
        const refreshed = await getAccessToken("codebuddy-cn", { refreshToken: conn.refreshToken }, log);
        if (refreshed?.accessToken) token = refreshed.accessToken;
      } catch {}
    }
    if (token) return { conn, token };
  }
  return { conn: null, token: null };
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

  const { conn, token } = await pickCredential(log);
  if (!token || !conn) {
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

  const uid = jwtSub(token);
  let response;
  try {
    response = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: buildVideoHeaders(token, uid),
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    return {
      status: 502,
      json: { error: { message: `Upstream request failed: ${error.message}`, type: "upstream_error" } },
    };
  }

  const text = await response.text().catch(() => "");
  let outer;
  try { outer = JSON.parse(text); } catch {
    return {
      status: 502,
      json: { error: { message: `Video submit not JSON: ${text.slice(0, 200)}`, type: "upstream_error" } },
    };
  }

  if (outer.code !== 0 || !outer.data?.id) {
    return {
      status: response.status || 502,
      json: {
        error: {
          message: `Video submit failed: code=${outer.code}, msg=${outer.msg || "unknown"}`,
          type: "upstream_error",
        },
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
export async function pollVideoJob(taskId, options = {}) {
  const log = options.log || null;
  const existing = await getVideoJobByTaskId(taskId);
  if (!existing) return { status: 404, json: { error: { message: "Job not found" } } };

  if (existing.status === "completed" || existing.status === "failed") {
    return { status: 200, json: existing };
  }

  const { token } = await pickCredential(log);
  if (!token) return { status: 200, json: existing };
  const uid = jwtSub(token);

  let response;
  try {
    response = await fetch(POLL_URL, {
      method: "POST",
      headers: buildVideoHeaders(token, uid),
      body: JSON.stringify({ task_id: taskId }),
    });
  } catch (error) {
    return { status: 200, json: existing };
  }
  const text = await response.text().catch(() => "");
  let outer;
  try { outer = JSON.parse(text); } catch {
    await updateVideoJob(existing.id, { status: "failed", errorMessage: `poll not JSON: ${text.slice(0, 120)}` });
    return { status: 200, json: await getVideoJobByTaskId(taskId) };
  }
  if (outer.code !== 0) {
    await updateVideoJob(existing.id, { status: "failed", errorMessage: `poll code=${outer.code} msg=${outer.msg}` });
    return { status: 200, json: await getVideoJobByTaskId(taskId) };
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
