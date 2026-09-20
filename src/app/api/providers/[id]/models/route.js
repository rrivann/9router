import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";

const ALLOWED_PROVIDERS = new Set(["codebuddy", "codebuddy-cn"]);

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (!ALLOWED_PROVIDERS.has(connection.provider)) {
      return NextResponse.json(
        { error: `Provider ${connection.provider} is not supported` },
        { status: 404 }
      );
    }

    const models = getModelsByProviderId(connection.provider) || [];
    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
      })),
    });
  } catch (error) {
    console.log("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
