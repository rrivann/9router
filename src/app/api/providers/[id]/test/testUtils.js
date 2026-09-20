/**
 * Provider connection test utility — CodeBuddy-only fork.
 *
 * Both CodeBuddy variants (Global + CN) speak the same 0penAI-compatible
 * `/v2/chat/completions` endpoint and expose a billing endpoint at
 * `/v2/billing/meter/get-user-resource` (POST, Bearer auth). We POST an empty
 * body to that URL to probe the credential — cheap (no chat completion
 * charge) and works with both API keys and OAuth access tokens.
 */

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { PROVIDERS } from "open-sse/config/providers.js";

const SUPPORTED_PROVIDERS = new Set(["codebuddy", "codebuddy-cn"]);

// Billing endpoints (same as PROVIDERS[id].usage.url in the registry).
const BILLING_URLS = {
  codebuddy: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
  "codebuddy-cn": "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
};

export function classifyOAuthProbeResult(res, _config, bodyText = "") {
  if (res.ok) {
    return { valid: true, statusCode: res.status };
  }
  const message = bodyText && bodyText.length < 500 ? bodyText : `HTTP ${res.status}`;
  return {
    valid: false,
    statusCode: res.status,
    error: `Probe failed: ${message}`,
  };
}

async function pingCodeBuddy(connection) {
  const url = BILLING_URLS[connection.provider];
  if (!url) {
    return { valid: false, error: `Missing billing URL for ${connection.provider}` };
  }

  const token = connection.apiKey || connection.accessToken;
  if (!token) {
    return { valid: false, error: "Missing credential (apiKey or accessToken)" };
  }

  const providerCfg = PROVIDERS[connection.provider];
  const headers = {
    ...(providerCfg?.headers || {}),
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: "{}",
    });
    const bodyText = await res.text().catch(() => "");

    if (!res.ok) {
      return classifyOAuthProbeResult(res, providerCfg, bodyText);
    }

    // CodeBuddy returns { code: 0, msg: "..." } on success; anything else is a
    // reachable-endpoint-but-bad-credential response and should count as a fail.
    try {
      const json = JSON.parse(bodyText);
      if (json?.code === 0) {
        return { valid: true, statusCode: res.status };
      }
      return {
        valid: false,
        statusCode: res.status,
        error: `CodeBuddy rejected credential: ${json?.msg || "unknown error"}`,
      };
    } catch {
      // Body wasn't JSON but HTTP was OK — treat as valid (endpoint reachable + auth accepted)
      return { valid: true, statusCode: res.status };
    }
  } catch (error) {
    return { valid: false, error: `Network error: ${error.message}` };
  }
}

export async function testSingleConnection(id) {
  const connection = await getProviderConnectionById(id);
  if (!connection) {
    return { valid: false, error: "Connection not found" };
  }
  if (!SUPPORTED_PROVIDERS.has(connection.provider)) {
    const result = {
      valid: false,
      error: `Provider ${connection.provider} not supported in this build`,
    };
    await updateProviderConnection(id, {
      testStatus: "failed",
      lastError: result.error,
      lastErrorAt: new Date().toISOString(),
    });
    return result;
  }

  const result = await pingCodeBuddy(connection);
  await updateProviderConnection(id, {
    testStatus: result.valid ? "active" : "failed",
    lastError: result.valid ? null : result.error || "Test failed",
    lastErrorAt: result.valid ? null : new Date().toISOString(),
  });
  return result;
}
