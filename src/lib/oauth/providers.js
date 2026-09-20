/**
 * OAuth Provider Configurations and Handlers
 * CodeBuddy-only fork — every other OAuth flow was pruned. Only CodeBuddy CN
 * (Tencent) uses OAuth in this fork; CodeBuddy Global uses API keys.
 */

// Ensure outbound fetch respects HTTP(S)_PROXY/ALL_PROXY in Node runtime
import "open-sse/index.js";

import { generatePKCE } from "./utils/pkce";
import { CODEBUDDY_CONFIG } from "./constants/oauth";

// Provider configurations
const PROVIDERS = {
  // CodeBuddy CN (Tencent) — Browser OAuth Polling Flow.
  //
  // Flow:
  //   1. POST stateUrl → { state, authUrl }
  //   2. Open authUrl in browser
  //   3. Poll tokenUrl with state until success (code 0) or timeout
  "codebuddy-cn": {
    config: CODEBUDDY_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(`${config.stateUrl}?platform=${config.platform}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": config.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "copilot.tencent.com",
          "X-No-Authorization": "true",
          "X-No-User-Id": "true",
          "X-Product": "SaaS",
        },
        body: "{}",
      });
      if (!response.ok) throw new Error(`CodeBuddy state request failed: ${await response.text()}`);
      const data = await response.json();
      if (data.code !== 0 || !data.data?.state || !data.data?.authUrl) {
        throw new Error(`CodeBuddy state error: ${data.msg || "missing state/authUrl"}`);
      }
      return {
        device_code: data.data.state,
        verification_uri: data.data.authUrl,
        user_code: "",
        interval: config.pollInterval / 1000,
        _isCodeBuddy: true,
      };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(`${config.tokenUrl}?state=${encodeURIComponent(deviceCode)}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": config.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          "X-Domain": "copilot.tencent.com",
          "X-No-Authorization": "true",
          "X-No-User-Id": "true",
          "X-No-Enterprise-Id": "true",
          "X-No-Department-Info": "true",
          "X-Product": "SaaS",
        },
      });
      if (!response.ok) return { ok: false, data: { error: "request_failed" } };
      const data = await response.json();
      if (data.code === 0 && data.data?.accessToken) {
        return {
          ok: true,
          data: {
            access_token: data.data.accessToken,
            refresh_token: data.data.refreshToken || "",
            token_type: data.data.tokenType || "Bearer",
            expires_in: data.data.expiresIn,
          },
        };
      }
      if (data.code === 11217) return { ok: true, data: { error: "authorization_pending" } };
      return { ok: false, data: { error: data.msg || "unknown_error" } };
    },
    mapTokens: (tokens) => ({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 86400,
      providerSpecificData: {},
    }),
  },
};

export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

export async function generateAuthData(providerName, redirectUri, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;
  const { codeVerifier, codeChallenge, state } = generatePKCE(provider.pkceVerifierBytes);

  let authUrl;
  if (provider.flowType === "device_code") {
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, codeChallenge, meta || {});
  } else {
    authUrl = provider.buildAuthUrl(config, redirectUri, state, undefined, meta || {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta || {})
    : provider.config;

  const tokens = await provider.exchangeToken(config, code, redirectUri, codeVerifier, state, meta || {});

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

export async function requestDeviceCode(providerName, codeChallenge, options) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return await provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

export async function pollForToken(providerName, deviceCode, codeVerifier, extraData) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    if (result.data.access_token) {
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      return { success: true, tokens };
    }
    if (result.data.error === "authorization_pending" || result.data.error === "slow_down") {
      return {
        success: false,
        error: result.data.error,
        errorDescription: result.data.error_description || result.data.message,
        pending: result.data.error === "authorization_pending",
      };
    }
    return {
      success: false,
      error: result.data.error || "no_access_token",
      errorDescription: result.data.error_description || result.data.message || "No access token received",
    };
  }

  return { success: false, error: result.data.error, errorDescription: result.data.error_description };
}
