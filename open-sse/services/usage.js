/**
 * Usage Fetcher - Get usage data from provider APIs.
 * CodeBuddy-only fork: only CodeBuddy Global + CN usage handlers survive.
 */

import { getCodeBuddyCnUsage } from "./usage/codebuddy-cn.js";
import { getCodeBuddyUsage } from "./usage/codebuddy.js";

const USAGE_HANDLERS = {
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  codebuddy: (c) => getCodeBuddyUsage(c.accessToken, c.providerSpecificData, c.proxyOptions, c.apiKey),
};

export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({ id: connection.id, provider, accessToken, apiKey, providerSpecificData, providerDataWithProjectId, proxyOptions });
}
