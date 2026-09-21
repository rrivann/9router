import { NextResponse } from "next/server";
import { handleImageGeneration } from "open-sse/handlers/imageGeneration.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /v1/images/generations (also /api/v1/images/generations)
// 0penAI-compatible: { model, prompt, n?, size?, quality?, response_format? }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { status, json } = await handleImageGeneration(body);
    return NextResponse.json(json, { status });
  } catch (error) {
    console.error("[images/generations] failed:", error);
    return NextResponse.json(
      { error: { message: `Server error: ${error.message}`, type: "server_error" } },
      { status: 500 }
    );
  }
}
