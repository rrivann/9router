// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                                    // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                                // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],              // GPT-5.x / o-series (no "max")
  openaiMax: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],    // OpenAI-compat gateways that accept "max" (e.g. CodeBuddy Global)
  levelMax: ["none", "low", "medium", "high", "max"],                         // claude-adaptive, kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],                 // claude-budget
  gemini: ["minimal", "low", "medium", "high"],                               // gemini-3 thinkingLevel (no disable)
  hiMax: ["none", "high", "max"],                                             // deepseek (low/med→high, xhigh→max)
};

// Providers whose 0penAI-compatible gateway extends reasoning_effort with "max"
// (mirrors OPENAI_MAX_EFFORT_PROVIDERS in translator/concerns/thinkingUnified.js).
const OPENAI_MAX_PROVIDERS = new Set(["codebuddy", "codebuddy-cn"]);

// thinkingFormat → valid selectable levels (source of truth for UI options).
const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.levelMax,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
};

// Model-name pattern overrides (glob, first match wins) — more precise than format default.
// `provider` field scopes the entry to a single provider; entries without a
// `provider` field match any provider (global fallback).
const PATTERN_THINKING = [
  { pattern: "*gpt-5.6-sol*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  // GPT-6 Astra: same effort set as GPT-5.6 Sol (accepts max).
  { pattern: "*gpt-6*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  // codebuddy-cn per-model effort sets — the server's product-config payload
  // publishes `reasoning.supportedEfforts` per model. NOTE: the chat endpoint
  // accepts any level you send (probed none/minimal/low/medium/high/xhigh/max
  // → all 200), but values outside a model's supportedEfforts are silently
  // clamped, so the declared set stays authoritative for the picker. Models
  // that publish no supportedEfforts (glm-5.1 / glm-5v-turbo / kimi-k2.x /
  // kimi-k3-1 / minimax-m3) fall through to the openai format default.
  { provider: "codebuddy-cn", pattern: "glm-5.3*",     levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.2",      levels: ["high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "deepseek-v4*", levels: ["low", "high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "hy3*",         levels: ["low", "high"] },
  { provider: "codebuddy-cn", pattern: "hy4*",         levels: ["high"] },
];

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
  );
  let levels = hit?.levels || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  // OpenAI-compat gateways that accept the extended "max" effort (CodeBuddy)
  // still use thinkingFormat:"openai" — expand the level set for those providers.
  // Some specific models on those providers still cap at "xhigh" — skip them.
  if (
    !hit
    && caps.thinkingFormat === "openai"
    && OPENAI_MAX_PROVIDERS.has(provider)
  ) {
    levels = L.openaiMax;
  }
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
