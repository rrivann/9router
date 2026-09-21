import { NextResponse } from "next/server";
import { generateSnippet, getIntegrationSpec } from "@/lib/integrations/specs";

export const dynamic = "force-dynamic";

// POST /api/integrations/[key]/snippet
// Body: { baseUrl, apiKey, models: string[] }
// Returns: { snippets: [{ path, format, content }, ...] }
export async function POST(request, { params }) {
  try {
    const { key } = await params;
    const spec = getIntegrationSpec(key);
    if (!spec) {
      return NextResponse.json({ error: `Unknown integration: ${key}` }, { status: 404 });
    }

    const body = await request.json();
    const models = Array.isArray(body?.models) ? body.models : [];
    if (models.length === 0) {
      return NextResponse.json({ error: "At least one model is required" }, { status: 400 });
    }
    if (!spec.multiModel && models.length > 1) {
      return NextResponse.json(
        { error: `${spec.name} accepts a single model only` },
        { status: 400 },
      );
    }

    const snippets = generateSnippet(key, {
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      models,
    });
    if (!snippets) {
      return NextResponse.json({ error: "Failed to generate snippet" }, { status: 500 });
    }

    return NextResponse.json({ snippets });
  } catch (error) {
    console.log("Error generating snippet:", error);
    return NextResponse.json({ error: "Failed to generate snippet" }, { status: 500 });
  }
}
