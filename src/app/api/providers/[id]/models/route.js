import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

const ALLOWED_PROVIDERS = new Set(["codebuddy", "codebuddy-cn"]);
const COMPATIBLE_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPATIBLE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Custom nodes have no registry entry — list models from their own upstream.
async function fetchCompatibleModels(connection) {
  const baseUrl = String(connection.providerSpecificData?.baseUrl || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    return { error: "Missing base URL for this compatible provider", status: 400 };
  }

  const token = connection.apiKey || connection.accessToken;
  if (!token) {
    return { error: "Missing credential (apiKey or accessToken)", status: 400 };
  }

  const isAnthropic = isAnthropicCompatibleProvider(connection.provider);
  const headers = isAnthropic
    ? { "x-api-key": token, "anthropic-version": "2023-06-01", Authorization: `Bearer ${token}` }
    : { Authorization: `Bearer ${token}` };

  try {
    const res = await fetchWithTimeout(`${baseUrl}/models`, { headers });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { error: "API key unauthorized", status: 401 };
      }
      return {
        error: `/models endpoint returned ${res.status}`,
        status: res.status === 404 ? 404 : 502,
      };
    }

    const json = await res.json().catch(() => null);
    // Accept the OpenAI shape ({data:[...]}), Anthropic ({data:[...]}), or a
    // bare array / {models:[...]} from less standard gateways.
    const raw = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
          ? json.models
          : [];

    const models = raw
      .map((model) => {
        const id = model?.id || model?.model || model?.name;
        if (!id) return null;
        return { id, name: model?.display_name || model?.name || id };
      })
      .filter(Boolean);

    return { models };
  } catch (error) {
    return {
      error: error.name === "AbortError"
        ? `Request timeout (>${COMPATIBLE_TIMEOUT_MS / 1000}s)`
        : `Network error: ${error.message}`,
      status: 502,
    };
  }
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider)) {
      const result = await fetchCompatibleModels(connection);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        provider: connection.provider,
        connectionId: connection.id,
        models: result.models,
      });
    }

    if (!ALLOWED_PROVIDERS.has(connection.provider)) {
      return NextResponse.json(
        { error: `Provider ${connection.provider} is not supported` },
        { status: 404 }
      );
    }

    const models = getModelsByProviderId(connection.provider) || [];
    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
      })),
    });
  } catch (error) {
    console.log("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}