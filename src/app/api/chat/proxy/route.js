// Server-side proxy so the dashboard Chat page doesn't need to know the API
// key. The route is behind the dashboard auth guard (see dashboardGuard.js
// PROTECTED_API_PATHS "/api/chat"), so only authenticated dashboard sessions
// can call it. Body is forwarded verbatim to /api/v1/chat/completions with
// the first active key attached.

import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { UPDATER_CONFIG } from "@/shared/constants/config";

export const dynamic = "force-dynamic";
const CLI_TOKEN_SALT = "9r-cli-auth";

async function forward(request) {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}
  if (!apiKey) {
    return NextResponse.json({ error: "No active API key. Create one under Endpoint & Key." }, { status: 400 });
  }

  const bodyText = await request.text();
  const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "x-9r-cli-token": await getConsistentMachineId(CLI_TOKEN_SALT),
  };

  const upstream = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers,
    body: bodyText,
    // upstream stream must not be pre-buffered; forward the ReadableStream as-is
    // @ts-ignore Node fetch supports duplex for streaming
    duplex: "half",
  });

  // Streaming response? Pass Content-Type through.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function POST(request) {
  try {
    return await forward(request);
  } catch (error) {
    console.error("[chat/proxy] failed:", error);
    return NextResponse.json({ error: `Proxy failed: ${error.message}` }, { status: 502 });
  }
}
