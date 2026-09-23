import { NextResponse } from "next/server";
import { getDefaultModel } from "open-sse/config/providerModels.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { normalizeProviderId } from "@/lib/providerNormalization";

// POST /api/providers/validate - Validate API key with provider.
// Generic 0penAI-compatible probe: hit /models first, fall back to a minimal chat completion.
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey } = body;

    if (!provider || !apiKey) {
      return NextResponse.json({ error: "Provider and API key required" }, { status: 400 });
    }

    const cfg = PROVIDERS[provider];
    if (!cfg || cfg.format !== "openai" || !cfg.baseUrl) {
      return NextResponse.json({ error: "Provider validation not supported" }, { status: 400 });
    }

    let isValid = false;
    let error = null;

    try {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
      else headers["Authorization"] = `Bearer ${apiKey}`;

      // Try /models first (fast GET), fallback to chat probe on ambiguous response.
      const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
      let probeOk = null;
      try {
        const probeRes = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
        if (probeRes.status === 401 || probeRes.status === 403) probeOk = false;
        else if (probeRes.ok) probeOk = true;
      } catch { /* fallback to chat */ }

      if (probeOk !== null) {
        isValid = probeOk;
      } else {
        const defaultModel = getDefaultModel(provider) || "test";
        const chatRes = await fetch(cfg.baseUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: defaultModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
          signal: AbortSignal.timeout(10000),
        });
        isValid = chatRes.status !== 401 && chatRes.status !== 403;
      }
    } catch (err) {
      error = err.message;
      isValid = false;
    }

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : (error || "Invalid API key"),
    });
  } catch (err) {
    console.log("Error validating API key:", err);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
