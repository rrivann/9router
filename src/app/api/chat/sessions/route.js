import { NextResponse } from "next/server";
import { listChatSessions, createChatSession } from "@/lib/db/repos/chatSessionsRepo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = await listChatSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[chatSessions] list failed:", error);
    return NextResponse.json({ error: "Failed to list chat sessions" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const session = await createChatSession({
      model: typeof body?.model === "string" ? body.model : null,
      title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "New chat",
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error("[chatSessions] create failed:", error);
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }
}
