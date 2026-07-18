import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings, updateProviderConnection, deleteProviderConnection } from "@/lib/localDb";

// Handle upstream 403 "Access denied" (IP/anti-abuse — refresh doesn't help).
// Default action: DELETE the connection permanently after N occurrences.
// Threshold default 1 (immediate); action default "delete".
// Env overrides:
//   GROK_ACCESS_DENIED_THRESHOLD=1          # occurrences required
//   GROK_ACCESS_DENIED_ACTION=delete|disable|error   # what to do
const ACCESS_DENIED_DISABLE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.GROK_ACCESS_DENIED_THRESHOLD || "1", 10) || 1
);
const ACCESS_DENIED_ACTION = (() => {
  const raw = String(process.env.GROK_ACCESS_DENIED_ACTION || "delete").toLowerCase();
  return raw === "disable" || raw === "error" ? raw : "delete";
})();
const accessDeniedTracker = (() => {
  // connectionId → { count, timestamp } — records how many times each account
  // has hit an "access denied" error inside the TTL window.
  const entries = new Map();
  const TTL_MS = 10 * 60 * 1000;
  return {
    record(id) {
      if (!id) return;
      const now = Date.now();
      const prev = entries.get(id);
      if (!prev || now - prev.timestamp > TTL_MS) {
        entries.set(id, { count: 1, timestamp: now });
      } else {
        entries.set(id, { count: prev.count + 1, timestamp: now });
      }
    },
    count(id) {
      if (!id) return 0;
      const prev = entries.get(id);
      if (!prev) return 0;
      if (Date.now() - prev.timestamp > TTL_MS) {
        entries.delete(id);
        return 0;
      }
      return prev.count;
    },
    reset(id) {
      if (id) entries.delete(id);
    },
  };
})();
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  const modelStr = body.model;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) return result.response;

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs);

    // Auto-disable on well-known upstream failure modes so the account is
    // skipped in rotation and the user sees a clear reason in the dashboard.

    // 403 "Banned (request illegal)" — CodeBuddy code 11140. Refresh does not help.
    if (result.status === 403 && typeof result.error === "string" && result.error.includes("11140")) {
      try {
        await updateProviderConnection(credentials.connectionId, {
          isActive: false,
          testStatus: "error",
          lastError: "Banned (request illegal)",
          lastErrorAt: new Date().toISOString(),
        });
        log.warn("AUTH", `Account ${credentials.connectionName} auto-disabled (banned: request illegal)`);
      } catch (e) { log.warn("AUTH", `auto-disable (banned) failed: ${e.message}`); }
    }

    // 429 with CodeBuddy code 14018 — "Credits exhausted". Account has no more quota.
    if (result.status === 429 && typeof result.error === "string" && result.error.includes("14018")) {
      try {
        await updateProviderConnection(credentials.connectionId, {
          isActive: false,
          testStatus: "error",
          lastError: "Credits exhausted",
          lastErrorAt: new Date().toISOString(),
        });
        log.warn("AUTH", `Account ${credentials.connectionName} auto-disabled (credits exhausted)`);
      } catch (e) { log.warn("AUTH", `auto-disable (credits) failed: ${e.message}`); }
    }

    // 429 with free-tier exhaustion signal — resets on rolling 24h window.
    if (
      result.status === 429 &&
      typeof result.error === "string" &&
      (result.error.includes("free-usage-exhausted") ||
        result.error.includes("included free usage") ||
        /tokens \(actual\/limit\):\s*\d+\/\d+/.test(result.error))
    ) {
      try {
        await updateProviderConnection(credentials.connectionId, {
          isActive: false,
          testStatus: "error",
          lastError: "Free usage exhausted (resets rolling 24h)",
          lastErrorAt: new Date().toISOString(),
        });
        log.warn("AUTH", `Account ${credentials.connectionName} auto-disabled (free usage exhausted — resets 24h)`);
      } catch (e) { log.warn("AUTH", `auto-disable (free-usage) failed: ${e.message}`); }
    }

    // Upstream 502 connect timeout — mark error but keep account active (transient).
    if (result.status === 502 && typeof result.error === "string" && result.error.includes("connect timeout")) {
      try {
        await updateProviderConnection(credentials.connectionId, {
          testStatus: "error",
          lastError: "Connect timeout",
          lastErrorAt: new Date().toISOString(),
        });
        log.warn("AUTH", `Account ${credentials.connectionName} connect timeout — marked error, skipping`);
      } catch (e) { log.warn("AUTH", `mark connect-timeout failed: ${e.message}`); }
    }

    // Upstream 403 "Access denied" that survives OAuth refresh + retry is
    // an anti-abuse / IP block, not a per-account token issue. Track
    // consecutive occurrences per connection and act after a threshold.
    // Default: DELETE the connection (farm-account preset, override via env).
    if (
      result.status === 403 &&
      typeof result.error === "string" &&
      /access denied/i.test(result.error) &&
      !result.error.includes("11140")
    ) {
      accessDeniedTracker.record(credentials.connectionId);
      const streak = accessDeniedTracker.count(credentials.connectionId);
      if (streak >= ACCESS_DENIED_DISABLE_THRESHOLD) {
        const label = credentials.connectionName || credentials.connectionId?.slice?.(0, 8) || "?";
        try {
          if (ACCESS_DENIED_ACTION === "delete") {
            await deleteProviderConnection(credentials.connectionId);
            log.warn("AUTH", `Account ${label} DELETED (403 Access denied ${streak}× — IP/anti-abuse; refresh does not help)`);
          } else if (ACCESS_DENIED_ACTION === "disable") {
            await updateProviderConnection(credentials.connectionId, {
              isActive: false,
              testStatus: "error",
              lastError: `403 Access denied ${streak}× (IP/anti-abuse — refresh does not help)`,
              lastErrorAt: new Date().toISOString(),
            });
            log.warn("AUTH", `Account ${label} auto-disabled (403 Access denied ${streak}×)`);
          } else {
            await updateProviderConnection(credentials.connectionId, {
              testStatus: "error",
              lastError: `403 Access denied ${streak}× (IP/anti-abuse — refresh does not help)`,
              lastErrorAt: new Date().toISOString(),
            });
            log.warn("AUTH", `Account ${label} marked error (403 Access denied ${streak}×)`);
          }
        } catch (e) { log.warn("AUTH", `access-denied action failed: ${e.message}`); }
        accessDeniedTracker.reset(credentials.connectionId);
      }
    }

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
