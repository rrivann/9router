import { NextResponse } from "next/server";
import { listPublicSpecs } from "@/lib/integrations/specs";
import { getApiKeys } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";

export const dynamic = "force-dynamic";

// GET /api/integrations
// Returns { integrations: [...specs], gateway: { baseUrl, apiKey } }
// baseUrl is the fork's local origin; the client can override it in the modal
// (e.g. tunnel URL). apiKey is the first active key so the snippet is ready to
// copy — the modal masks it until "reveal".
export async function GET(request) {
  try {
    const integrations = listPublicSpecs();

    const requestOrigin = new URL(request.url).origin;
    const baseUrl = requestOrigin || `http://localhost:${UPDATER_CONFIG.appPort}`;

    let apiKey = "";
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || "";
    } catch {
      // No keys yet — the modal shows a placeholder.
    }

    return NextResponse.json({
      integrations,
      gateway: { baseUrl, apiKey },
    });
  } catch (error) {
    console.log("Error listing integrations:", error);
    return NextResponse.json({ error: "Failed to list integrations" }, { status: 500 });
  }
}
