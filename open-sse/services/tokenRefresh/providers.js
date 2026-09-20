import { PROVIDER_OAUTH } from "../../config/providers.js";
import { dedupRefresh } from "./dedup.js";

export function classifyOAuthRefreshError(errorText = "", status = 0) {
  let parsed = null;
  try {
    parsed = errorText ? JSON.parse(errorText) : null;
  } catch {
    parsed = null;
  }

  const code = parsed?.error?.code || parsed?.error || parsed?.error_code || "";
  const description = parsed?.error_description || parsed?.message || errorText || "";
  const combined = `${code} ${description}`.toLowerCase();
  const permanent = [
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
    "invalid_grant",
  ].some((marker) => combined.includes(marker));

  return { status, code, description, permanent };
}

// CodeBuddy CN OAuth: refresh token carried in X-Refresh-Token header (not form body).
// Response: { code: 0, data: { accessToken, refreshToken, expiresIn } }.
export async function refreshCodebuddyToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("codebuddy-cn", refreshToken, async () => {
    const oauth = PROVIDER_OAUTH["codebuddy-cn"] || {};
    const response = await fetch(oauth.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": oauth.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "copilot.tencent.com",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS",
      },
      body: "{}",
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const data = await response.json();
    if (data.code !== 0 || !data.data?.accessToken) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy token refresh returned no token", {
        code: data.code,
        msg: data.msg,
      });
      return null;
    }

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed CodeBuddy token", {
      hasNewAccessToken: !!data.data.accessToken,
      hasNewRefreshToken: !!data.data.refreshToken,
      expiresIn: data.data.expiresIn,
    });

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken || refreshToken,
      expiresIn: data.data.expiresIn,
    };
  }, log);
}
