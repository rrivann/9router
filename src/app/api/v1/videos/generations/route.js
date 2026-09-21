import { NextResponse } from "next/server";
import { submitVideoJob } from "open-sse/handlers/videoGeneration.js";

export const dynamic = "force-dynamic";

// POST /v1/videos/generations
// Submit a new video job. Returns immediately with taskId + status:queued.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { status, json } = await submitVideoJob(body);
    return NextResponse.json(json, { status });
  } catch (error) {
    console.error("[videos/generations] failed:", error);
    return NextResponse.json(
      { error: { message: `Server error: ${error.message}`, type: "server_error" } },
      { status: 500 }
    );
  }
}
