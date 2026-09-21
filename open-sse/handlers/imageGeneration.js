// Image generation handler — CodeBuddy Global only.
//
// POST /v1/images/generations
// Request:  { model: "cb/gpt-image-2" | "cb/gemini-*-image", prompt, n?, size?, ...  }
// Response: { created, data: [{ url? , b64_json?, revised_prompt? }, ...] }
//
// Wire: POST https://www.codebuddy.ai/v2/images/generations
// Upstream returns Tencent envelope { code, msg, data: { created, data: [...] } }
// which we unwrap to standard 0penAI shape.

import { randomUUID } from "crypto";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getAccessToken } from "../services/tokenRefresh.js";

const CB_IMAGE_URL = "https://www.codebuddy.ai/v2/images/generations";
const IMAGE_MODEL_PREFIX = "cb/";
const CLIENT_VERSION = "2.108.1";
const USER_AGENT = `CLI/${CLIENT_VERSION} CodeBuddy/${CLIENT_VERSION}`;

function stripAlias(model) {
  return typeof model === "string" && model.startsWith(IMAGE_MODEL_PREFIX)
    ? model.slice(IMAGE_MODEL_PREFIX.length)
    : model;
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

export async function handleImageGeneration(body, options = {}) {
  const log = options.log || null;
  const modelRaw = typeof body?.model === "string" ? body.model : "";
  if (!modelRaw) {
    return {
      status: 400,
      json: { error: { message: "Missing 'model'", type: "invalid_request_error" } },
    };
  }

  const { conn, token } = await pickCredential(log);
  if (!token || !conn) {
    return {
      status: 401,
      json: { error: { message: "No active CodeBuddy Global connection", type: "authentication_error" } },
    };
  }

  const upstreamModel = stripAlias(modelRaw);
  const upstreamBody = {
    model: upstreamModel,
    prompt: typeof body?.prompt === "string" ? body.prompt : "",
  };
  if (typeof body?.n === "number") upstreamBody.n = body.n;
  if (typeof body?.size === "string") upstreamBody.size = body.size;
  if (typeof body?.quality === "string") upstreamBody.quality = body.quality;
  if (typeof body?.response_format === "string") upstreamBody.response_format = body.response_format;

  const reqId = randomUUID().replace(/-/g, "");
  const conversationId = randomUUID();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    "X-Requested-With": "XMLHttpRequest",
    "X-Domain": "www.codebuddy.ai",
    "X-Product": "SaaS",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "X-IDE-Version": CLIENT_VERSION,
    "X-Request-ID": reqId,
    "X-Conversation-ID": conversationId,
    "X-Conversation-Request-ID": conversationId,
    Authorization: `Bearer ${token}`,
  };

  let response;
  try {
    response = await fetch(CB_IMAGE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    return {
      status: 502,
      json: { error: { message: `Upstream request failed: ${error.message}`, type: "upstream_error" } },
    };
  }

  const rawText = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      status: response.status || 502,
      json: {
        error: {
          message: `CodeBuddy image gen failed: ${rawText.slice(0, 500) || `HTTP ${response.status}`}`,
          type: "upstream_error",
        },
      },
    };
  }

  let outer;
  try {
    outer = JSON.parse(rawText);
  } catch {
    return {
      status: 502,
      json: {
        error: {
          message: `Image response was not JSON: ${rawText.slice(0, 200)}`,
          type: "upstream_error",
        },
      },
    };
  }

  if (outer.code !== 0) {
    return {
      status: 502,
      json: {
        error: {
          message: `CodeBuddy image error: code=${outer.code}, msg=${outer.msg || "unknown"}`,
          type: "upstream_error",
        },
      },
    };
  }

  const created = outer.data?.created ?? Math.floor(Date.now() / 1000);
  const data = Array.isArray(outer.data?.data) ? outer.data.data : [];
  return {
    status: 200,
    json: {
      created,
      data: data.map((d) => {
        const item = d || {};
        const out = {};
        if (typeof item.url === "string") out.url = item.url;
        if (typeof item.b64_json === "string") out.b64_json = item.b64_json;
        if (typeof item.revised_prompt === "string") out.revised_prompt = item.revised_prompt;
        return out;
      }),
    },
  };
}
