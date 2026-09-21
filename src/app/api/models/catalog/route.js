import { NextResponse } from "next/server";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

export const dynamic = "force-dynamic";

// Derive modalities array from registry hints. Inferhub-style: "text" is always
// present for chat models, "image" when the model accepts vision input, and
// "video" for video-in capable models. Kind-specific overrides for image/video
// generation models so the UI still tags them accurately.
function resolveModalities(model) {
  if (Array.isArray(model.modalities)) return model.modalities;
  const out = ["text"];
  if (model.images) out.push("image");
  if (model.video) out.push("video");
  if (model.kind === "image") return ["text", "image"];
  if (model.kind === "video") return ["text", "image", "video"];
  return out;
}

// Human-facing effort ladder for the Models page. Precedence:
//   1. Explicit reasoningLevels on the registry entry (authoritative override)
//   2. Provider/model resolution via getThinkingLevels() — same list the CLI
//      thinking picker uses, so the UI and wire stay in sync
//   3. null when the model isn't reasoning-capable
// Gated on model.thinking so non-reasoning models don't inherit their format's
// default ladder (e.g. deepseek-v3-0324 declares thinking:false).
function resolveReasoningLevels(providerId, model) {
  if (!model.thinking) return null;
  if (Array.isArray(model.reasoningLevels)) return model.reasoningLevels;
  const levels = getThinkingLevels(providerId, model.id);
  if (!levels || !Array.isArray(levels)) return null;
  // Drop "none" — the UI badge shows the *positive* effort ladder, and "none"
  // is implicit (thinkingToggle: canDisable) rather than a picker option.
  const cleaned = levels.filter((l) => l !== "none");
  return cleaned.length > 0 ? cleaned : null;
}

// GET /api/models/catalog
// Returns every model in every registered provider with the full metadata
// (creditMultiplier, thinking, thinkingToggle, effort, images, toolCalls,
// max_input_tokens, max_output_tokens, owned_by, kind, modalities,
// reasoning_levels). Independent of the user's disabledModels — the Models
// page renders the full catalog and lets the user manage visibility from
// /dashboard/providers/{id}.
export async function GET() {
  try {
    const models = [];
    for (const provider of REGISTRY) {
      const alias = provider.uiAlias || provider.alias || provider.id;
      const list = Array.isArray(provider.models) ? provider.models : [];
      for (const m of list) {
        models.push({
          id: `${alias}/${m.id}`,
          providerId: provider.id,
          providerAlias: alias,
          providerName: provider.display?.name || provider.id,
          name: m.name || m.id,
          kind: m.kind || "chat",
          owned_by: m.ownedBy || null,
          max_input_tokens: m.maxInputTokens || null,
          max_output_tokens: m.maxOutputTokens || null,
          credit_multiplier: typeof m.creditMultiplier === "number" ? m.creditMultiplier : null,
          thinking: !!m.thinking,
          thinking_toggle: m.thinkingToggle || null,
          effort: m.effort || null,
          reasoning_levels: resolveReasoningLevels(provider.id, m),
          modalities: resolveModalities(m),
          images: !!m.images,
          tool_calls: !!m.toolCalls,
        });
      }
    }
    return NextResponse.json({
      data: models,
      providers: [...new Set(models.map((m) => m.providerAlias))],
    });
  } catch (error) {
    console.error("[models/catalog] failed:", error);
    return NextResponse.json({ error: "Failed to fetch model catalog" }, { status: 500 });
  }
}
