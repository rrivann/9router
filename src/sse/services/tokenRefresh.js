// Re-export from open-sse with local logger
import * as log from "../utils/logger.js";
import { updateProviderConnection } from "../../lib/localDb.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshCodebuddyToken as _refreshCodebuddyToken,
  getAccessToken as _getAccessToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  formatProviderCredentials as _formatProviderCredentials,
  getAllAccessTokens as _getAllAccessTokens,
  getRefreshLeadMs as _getRefreshLeadMs,
} from "open-sse/services/tokenRefresh.js";
import {
  refreshProviderCredentials as _refreshProviderCredentials,
  shouldRefreshCredentials as _shouldRefreshCredentials,
} from "open-sse/services/oauthCredentialManager.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

// ─── Re-exports wrapped with local logger ─────────────────────────────────────

export const refreshCodebuddyToken = (refreshToken) =>
  _refreshCodebuddyToken(refreshToken, log);

export const getAccessToken = (provider, credentials) =>
  _getAccessToken(provider, credentials, log);

export const refreshTokenByProvider = (provider, credentials) =>
  _refreshTokenByProvider(provider, credentials, log);

export const formatProviderCredentials = (provider, credentials) =>
  _formatProviderCredentials(provider, credentials, log);

export const getAllAccessTokens = (userInfo) =>
  _getAllAccessTokens(userInfo, log);

export const shouldRefreshCredentials = (provider, credentials) =>
  _shouldRefreshCredentials(provider, credentials);

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toExpiresAt(expiresIn) {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function normalizeExpiresAt(expiresAt) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

// ─── Local-specific: persist credentials to localDb ──────────────────────────

export async function updateProviderCredentials(connectionId, newCredentials) {
  try {
    const updates = {};

    if (newCredentials.accessToken)         updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken)        updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.idToken)             updates.idToken = newCredentials.idToken;
    if (newCredentials.lastRefreshAt)       updates.lastRefreshAt = newCredentials.lastRefreshAt;
    if (newCredentials.expiresAt)           updates.expiresAt = newCredentials.expiresAt;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn);
      updates.expiresIn = newCredentials.expiresIn;
    } else if (newCredentials.expiresAt) {
      const expiresAt = normalizeExpiresAt(newCredentials.expiresAt);
      if (expiresAt) {
        updates.expiresAt = expiresAt;
        updates.expiresIn = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      }
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...(newCredentials.existingProviderSpecificData || {}),
        ...newCredentials.providerSpecificData,
      };
    }
    if (newCredentials.projectId)            updates.projectId = newCredentials.projectId;

    const result = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in localDb", {
      connectionId,
      success: !!result
    });
    return !!result;
  } catch (error) {
    log.error("TOKEN_REFRESH", "Error updating credentials in localDb", {
      connectionId,
      error: error.message,
    });
    return false;
  }
}

// ─── Local-specific: proactive token refresh ─────────────────────────────────

export async function checkAndRefreshToken(provider, credentials) {
  let creds = { ...credentials };
  if (!creds.connectionId && creds.id) {
    creds.connectionId = creds.id;
  }

  if (_shouldRefreshCredentials(provider, creds)) {
    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : null;
    const remaining = expiresAt ? expiresAt - Date.now() : null;
    const refreshLead = _getRefreshLeadMs(provider);

    log.info("TOKEN_REFRESH", "Refreshing provider credentials proactively", {
      provider,
      expiresIn: remaining === null ? null : Math.round(remaining / 1000),
      refreshLeadMs: refreshLead,
      lastRefreshAt: creds.lastRefreshAt || null,
    });

    const newCreds = await _refreshProviderCredentials(provider, creds, log);
    if (newCreds?.accessToken || newCreds?.apiKey) {
      const mergedCreds = {
        ...newCreds,
        existingProviderSpecificData: creds.providerSpecificData,
      };

      await updateProviderCredentials(creds.connectionId, mergedCreds);

      creds = {
        ...creds,
        ...newCreds,
        expiresAt: newCreds.expiresIn
          ? toExpiresAt(newCreds.expiresIn)
          : normalizeExpiresAt(newCreds.expiresAt) || newCreds.expiresAt || creds.expiresAt,
        providerSpecificData: newCreds.providerSpecificData
          ? { ...creds.providerSpecificData, ...newCreds.providerSpecificData }
          : creds.providerSpecificData,
      };
    }
  }

  return creds;
}

export function releaseConnection(_connectionId) {
  // No-op: dynamic project-id cache tied to gemini-cli/antigravity has been removed with those providers.
}
