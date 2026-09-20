/**
 * OAuth Configuration Constants — static data lives in registry, re-exported here for consumers.
 * This fork keeps only CodeBuddy CN OAuth; every other provider was removed in the CodeBuddy-only pruning.
 */
import { PROVIDER_OAUTH } from "open-sse/providers/index.js";

// CodeBuddy (Tencent) OAuth Configuration (Browser OAuth Polling Flow)
export const CODEBUDDY_CONFIG = { ...PROVIDER_OAUTH["codebuddy-cn"] };

// OAuth timeout (5 minutes)
export const OAUTH_TIMEOUT = 300000;

// Provider list
export const PROVIDERS = {
  CODEBUDDY: "codebuddy-cn",
};
