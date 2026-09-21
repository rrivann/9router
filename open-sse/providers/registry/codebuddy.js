export default {
  id: "codebuddy",
  alias: "cb",
  uiAlias: "cb",
  hidden: false,
  priority: 89,
  display: {
    name: "CodeBuddy Global",
    icon: "smart_toy",
    color: "#7C3AED",
    website: "https://www.codebuddy.ai",
    notice: { signupUrl: "https://www.codebuddy.ai" },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    forceStream: true,
    // CodeBuddy global speaks the same unified OpenAI reasoning_effort shape as CN.
    // Prevents the generic *claude* pattern from routing these models through the
    // claude-adaptive path (which would clamp xhigh → high in output_config.effort).
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
      "X-Product": "SaaS",
      "X-App": "cli",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "X-IDE-Version": "2.108.1",
      "X-Private-Data": "false",
      "X-Requested-With": "XMLHttpRequest",
      "x-codebuddy-request": "1",
      "X-Domain": "www.codebuddy.ai",
    },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
    usage: {
      url: "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
    },
  },
  // Chat models — synced 2026-09-21 from decolua/gacor-router
  // (src/providers/codebuddy.models.ts). Media (image/video) is skipped: fork
  // is chat-only, image/video handlers + routes were pruned in cleanup.
  //
  // Extra per-model fields carried from gacor:
  //   creditMultiplier — cost per request relative to a "1x" baseline
  //   thinking         — model supports reasoning tokens
  //   thinkingToggle   — "canDisable" | "onlyReasoning"
  //   effort           — human-readable effort ladder (informational)
  //   images           — accepts image inputs
  //   toolCalls        — supports OpenAI-style tool_calls
  models: [
    // ── Alias tier (routes to backend-chosen model) ─────────────────
    { id: "default-model", name: "Auto ⭐default", maxInputTokens: 176000, maxOutputTokens: 24000, creditMultiplier: 1, images: true, toolCalls: true },
    { id: "fast-model", name: "Fast", maxInputTokens: 200000, maxOutputTokens: 32000, creditMultiplier: 0.34, thinking: true, thinkingToggle: "onlyReasoning", effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "balanced-model", name: "Balanced", maxInputTokens: 256000, maxOutputTokens: 32000, creditMultiplier: 0.59, thinking: true, thinkingToggle: "onlyReasoning", effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "primary-model", name: "Primary", maxInputTokens: 272000, maxOutputTokens: 72000, creditMultiplier: 3.31, thinking: true, thinkingToggle: "onlyReasoning", effort: "low→xhigh", images: true, toolCalls: true },
    { id: "deep-model", name: "Deep", maxInputTokens: 176000, maxOutputTokens: 24000, creditMultiplier: 3.33, images: true, toolCalls: true },

    // ── Claude family ────────────────────────────────────────────────
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", maxInputTokens: 176000, maxOutputTokens: 24000, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "claude-opus-5", name: "Claude Opus 5", maxInputTokens: 1000000, maxOutputTokens: 128000, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "claude-opus-4.7-1m", name: "Claude Opus 4.7 1M", maxInputTokens: 1000000, maxOutputTokens: 128000, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6", maxInputTokens: 1000000, maxOutputTokens: 128000, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },

    // ── DeepSeek family ──────────────────────────────────────────────
    { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash", maxInputTokens: 1000000, maxOutputTokens: 393216, creditMultiplier: 0, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "deepseek-v3-0324", name: "DeepSeek-V3", maxInputTokens: 128000, maxOutputTokens: 8192, images: true, toolCalls: true, strip: ["image", "audio"] },

    // ── GPT family ───────────────────────────────────────────────────
    { id: "gpt-6-astra", name: "GPT-6-Astra", maxInputTokens: 272000, maxOutputTokens: 128000, creditMultiplier: 6.67, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", reasoningLevels: ["low", "medium", "high"], images: true, toolCalls: true },
    { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", maxInputTokens: 272000, maxOutputTokens: 128000, creditMultiplier: 3.47, thinking: true, thinkingToggle: "canDisable", effort: "low→max (flaky 11134)", reasoningLevels: ["minimal", "low", "medium", "high"], images: true, toolCalls: false },
    { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", maxInputTokens: 272000, maxOutputTokens: 128000, creditMultiplier: 1.39, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", reasoningLevels: ["minimal", "low", "medium", "high"], images: true, toolCalls: true },
    { id: "gpt-5.6-luna", name: "GPT-5.6-Luna", maxInputTokens: 272000, maxOutputTokens: 128000, creditMultiplier: 0.14, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", reasoningLevels: ["minimal", "low", "medium", "high"], images: true, toolCalls: true },
    { id: "gpt-5.5", name: "GPT-5.5", maxInputTokens: 272000, maxOutputTokens: 128000, creditMultiplier: 3.31, thinking: true, effort: "low→xhigh", reasoningLevels: ["minimal", "low", "medium", "high"], images: true, toolCalls: true },
    { id: "gpt-5.4", name: "GPT-5.4", maxInputTokens: 272000, maxOutputTokens: 128000, creditMultiplier: 1.64, thinking: true, effort: "low→xhigh", reasoningLevels: ["minimal", "low", "medium", "high"], images: true, toolCalls: true },
    { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", maxInputTokens: 272000, maxOutputTokens: 128000, thinking: true, effort: "low→xhigh", reasoningLevels: ["minimal", "low", "medium", "high"], images: true, toolCalls: true },

    // ── Gemini family ────────────────────────────────────────────────
    { id: "gemini-3.5-flash", name: "Gemini-3.5-Flash", maxInputTokens: 1000000, maxOutputTokens: 65000, creditMultiplier: 0.99, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "gemini-3.1-pro", name: "Gemini-3.1-Pro", maxInputTokens: 1000000, maxOutputTokens: 65536, reasoningLevels: ["low", "high"], images: true, toolCalls: true },

    // ── GLM family ───────────────────────────────────────────────────
    { id: "glm-5.3-flash", name: "GLM-5.3-Flash", maxInputTokens: 1000000, maxOutputTokens: 128000, creditMultiplier: 0.06, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", images: true, toolCalls: true, strip: ["image", "audio"] },
    { id: "glm-5.3", name: "GLM-5.3", maxInputTokens: 1000000, maxOutputTokens: 128000, creditMultiplier: 0.79, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", reasoningLevels: ["low", "high", "max"], images: true, toolCalls: true, strip: ["image", "audio"] },
    { id: "glm-5.2", name: "GLM-5.2", maxInputTokens: 1000000, maxOutputTokens: 128000, creditMultiplier: 0.79, thinking: true, thinkingToggle: "canDisable", effort: "low→max (5 level)", reasoningLevels: ["low", "high", "max"], images: true, toolCalls: true, strip: ["image", "audio"] },

    // ── Tencent Hunyuan family ───────────────────────────────────────
    { id: "hy4-preview-f", name: "Hy4 preview F", maxInputTokens: 1000000, maxOutputTokens: 64000, creditMultiplier: 0, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "hy4-preview", name: "Hy4 preview", maxInputTokens: 1000000, maxOutputTokens: 64000, creditMultiplier: 0.29, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "hy3", name: "Hy3", maxInputTokens: 192000, maxOutputTokens: 64000, creditMultiplier: 0, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },

    // ── Kimi family ──────────────────────────────────────────────────
    { id: "kimi-k3", name: "Kimi-K3", maxInputTokens: 1000000, maxOutputTokens: 262144, creditMultiplier: 1.62, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "kimi-k2.8-preview", name: "Kimi-K2.8 (preview)", maxInputTokens: 256000, maxOutputTokens: 32000, creditMultiplier: 0.77, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "kimi-k2.6", name: "Kimi-K2.6", maxInputTokens: 256000, maxOutputTokens: 32000, creditMultiplier: 0.52, thinking: true, effort: "low→max (5 level)", images: true, toolCalls: true },
    { id: "kimi-k2.5", name: "Kimi-K2.5", maxInputTokens: 164000, maxOutputTokens: 32000, thinking: true, images: true, toolCalls: true },

    // ── MiniMax family ───────────────────────────────────────────────
    { id: "minimax-m3", name: "MiniMax-M3", maxInputTokens: 1000000, maxOutputTokens: 262144, images: true, toolCalls: true },

    // ── Image generation (kind: "image") ─────────────────────────────
    // Live-probed 2026-09-15: POST /v2/images/generations returns 200 with a
    // Tencent COS URL in the response. Chat endpoints reject or misroute these
    // ids, so they only serve /v1/images/generations.
    { id: "gpt-image-2", name: "GPT Image 2", ownedBy: "openai", kind: "image" },
    { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", ownedBy: "google", kind: "image" },
    { id: "gemini-3.0-pro-image", name: "Gemini 3.0 Pro Image", ownedBy: "google", kind: "image" },
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", ownedBy: "google", kind: "image" },

    // ── Video generation (kind: "video") ─────────────────────────────
    // Async: POST /v2/videos/generations returns { code: 0, data: { id, status } };
    // poll /v2/videos/tasks with { task_id } until status: "completed" (~3-4 min).
    // Constraint: seconds ∈ [4, 30]. Cost ≈ 21 credits/second at 720P.
    { id: "seedance-2.5", name: "Seedance 2.5", ownedBy: "bytedance", kind: "video" },
  ],
  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.108.1 CodeBuddy/2.108.1",
    platform: "CLI",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
