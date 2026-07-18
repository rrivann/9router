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

// Providers whose OpenAI-compatible gateway extends reasoning_effort with "max"
// (mirrors OPENAI_MAX_EFFORT_PROVIDERS in translator/concerns/thinkingUnified.js).
const OPENAI_MAX_PROVIDERS = new Set(["codebuddy", "codebuddy-cn", "qwencloud"]);

// Per-model exceptions: models on OPENAI_MAX_PROVIDERS providers that still cap
// at "xhigh" (upstream rejects "max"). Mirrors OPENAI_MAX_MODEL_EXCEPTIONS in
// translator/concerns/thinkingUnified.js.
const OPENAI_MAX_MODEL_EXCEPTIONS = new Set([
  "qwencloud:qwen3.7-max",
]);

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
const PATTERN_THINKING = [
  // gpt-5.6-sol accepts max (maps to xhigh on wire); live probe rejected ultra.
  { pattern: "*gpt-5.6-sol*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] }, // codex cannot disable thinking
];

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const hit = PATTERN_THINKING.find((p) => matchPattern(p.pattern, model));
  let levels = hit?.levels || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  // OpenAI-compat gateways that accept the extended "max" effort (CodeBuddy)
  // still use thinkingFormat:"openai" — expand the level set for those providers.
  // Some specific models on those providers still cap at "xhigh" — skip them.
  if (
    !hit
    && caps.thinkingFormat === "openai"
    && OPENAI_MAX_PROVIDERS.has(provider)
    && !OPENAI_MAX_MODEL_EXCEPTIONS.has(`${provider}:${model}`)
  ) {
    levels = L.openaiMax;
  }
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
