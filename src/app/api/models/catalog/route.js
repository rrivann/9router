import { NextResponse } from "next/server";
import REGISTRY from "open-sse/providers/registry/index.js";

export const dynamic = "force-dynamic";

// GET /api/models/catalog
// Returns every model in every registered provider with the full metadata
// (creditMultiplier, thinking, thinkingToggle, effort, images, toolCalls,
// max_input_tokens, max_output_tokens, owned_by, kind). Independent of the
// user's disabledModels — the Models page renders the full catalog and lets
// the user manage visibility from /dashboard/providers/{id}.
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
