import { REFRESH_LEAD_MS } from "../config/appConstants.js";
import {
  refreshCodebuddyToken,
  classifyOAuthRefreshError,
} from "./tokenRefresh/providers.js";

export {
  refreshCodebuddyToken,
  classifyOAuthRefreshError,
};

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function isUnrecoverableRefreshError(result) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

export function getRefreshLeadMs(provider) {
  return REFRESH_LEAD_MS[provider] || TOKEN_EXPIRY_BUFFER_MS;
}

const REFRESH_HANDLERS = {
  "codebuddy-cn": (c, log) => refreshCodebuddyToken(c.refreshToken, log),
};

export async function getAccessToken(provider, credentials, log) {
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }
  const handler = REFRESH_HANDLERS[provider];
  if (!handler) {
    log?.warn?.("TOKEN_REFRESH", `Unsupported provider for token refresh: ${provider}`);
    return null;
  }
  return handler(credentials, log);
}

export async function refreshTokenByProvider(provider, credentials, log) {
  if (!credentials.refreshToken) return null;
  const handler = REFRESH_HANDLERS[provider];
  return handler ? handler(credentials, log) : null;
}

export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const result = await refreshFn();
      if (result) return result;
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }
  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
