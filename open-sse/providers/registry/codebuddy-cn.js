export default {
  id: "codebuddy-cn",
  // Short model prefix (cbcn/glm-5.2). "cbcn" = CodeBuddy CN; reserve "cbai"
  // for a future codebuddy-ai (intl) provider. The full id still resolves.
  alias: "cbcn",
  uiAlias: "cbcn",
  hidden: false,
  priority: 90,
  display: {
    name: "CodeBuddy CN",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://copilot.tencent.com",
    notice: {
      signupUrl: "https://copilot.tencent.com",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://copilot.tencent.com/v2/chat/completions",
    forceStream: true,
    // CodeBuddy is a unified OpenAI-compatible gateway: every model (GLM, Kimi,
    // MiniMax, DeepSeek, Hunyuan) takes reasoning via OpenAI-style reasoning_effort,
    // not its vendor-native thinking shape. Force the openai thinking format.
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    // Quota endpoint differs from the chat gateway: POST returns nested Tencent
    // billing payload (data.Response.Data.Accounts[]). See services/usage/codebuddy-cn.js.
    usage: {
      url: "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
    },
  },
  // Tencent copilot.tencent.com chat catalog. Synced 2026-09-21 with
  // inferhub.dev/pricing published availability. Deprecated CN models
  // (glm-4.7/5.0/5.0-turbo/5.1/5v-turbo, hy3-preview, kimi-k2.5, deepseek-v3-2)
  // were dropped upstream — removed here to match.
  //
  // Ports/pricing (USD per 1M tokens): mapped from inferhub official rates.
  models: [
    // ── GLM (Zhipu) ─────────────────────────────────────────────────
    { id: "glm-5.3", name: "GLM-5.3", ownedBy: "zhipu", maxInputTokens: 1000000, maxOutputTokens: 128000, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", images: true, toolCalls: true, strip: ["image", "audio"] },
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash", ownedBy: "zhipu", maxInputTokens: 1000000, maxOutputTokens: 128000, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", images: true, toolCalls: true, strip: ["image", "audio"] },
    { id: "glm-5.2", name: "GLM-5.2", ownedBy: "zhipu", maxInputTokens: 1000000, maxOutputTokens: 128000, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", images: true, toolCalls: true, strip: ["image", "audio"] },

    // ── MiniMax ─────────────────────────────────────────────────────
    { id: "minimax-m3", name: "MiniMax-M3", ownedBy: "minimax", maxInputTokens: 1000000, maxOutputTokens: 262144, images: true, toolCalls: true },
    { id: "minimax-m2.7", name: "MiniMax-M2.7", ownedBy: "minimax", maxInputTokens: 1000000, maxOutputTokens: 262144, images: true, toolCalls: true },

    // ── Kimi (Moonshot) ─────────────────────────────────────────────
    { id: "kimi-k3", name: "Kimi-K3", ownedBy: "moonshot", maxInputTokens: 1000000, maxOutputTokens: 262144, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code", ownedBy: "moonshot", maxInputTokens: 262144, maxOutputTokens: 32000, thinking: true, images: true, toolCalls: true },
    { id: "kimi-k2.6", name: "Kimi-K2.6", ownedBy: "moonshot", maxInputTokens: 262144, maxOutputTokens: 32000, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },

    // ── Tencent Hunyuan ─────────────────────────────────────────────
    { id: "hy4-preview", name: "Hy4 preview", ownedBy: "tencent", maxInputTokens: 1000000, maxOutputTokens: 64000, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },

    // ── DeepSeek ────────────────────────────────────────────────────
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", ownedBy: "deepseek", maxInputTokens: 1000000, maxOutputTokens: 393216, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", ownedBy: "deepseek", maxInputTokens: 1000000, maxOutputTokens: 393216, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash", ownedBy: "deepseek", maxInputTokens: 1000000, maxOutputTokens: 393216, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
  ],
  oauth: {
    baseUrl: "https://copilot.tencent.com",
    stateUrl: "https://copilot.tencent.com/v2/plugin/auth/state",
    tokenUrl: "https://copilot.tencent.com/v2/plugin/auth/token",
    refreshUrl: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.63.2 CodeBuddy/2.63.2",
    platform: "CLI",
    pollInterval: 5000,
  },
  features: {
    usage: false,
    usageApikey: false,
  },
};
