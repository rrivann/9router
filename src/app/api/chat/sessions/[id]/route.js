import { NextResponse } from "next/server";
import { getChatSession, updateChatSession, deleteChatSession } from "@/lib/db/repos/chatSessionsRepo";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const session = await getChatSession(id);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ session });
  } catch (error) {
    console.error("[chatSessions] get failed:", error);
    return NextResponse.json({ error: "Failed to fetch chat session" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const patch = {};
    if (typeof body?.title === "string") patch.title = body.title.slice(0, 200);
    if (typeof body?.model === "string" || body?.model === null) patch.model = body.model;
    if (typeof body?.messages === "string") patch.messages = body.messages;
    if (typeof body?.messageCount === "number") patch.messageCount = body.messageCount;
    const result = await updateChatSession(id, patch);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[chatSessions] update failed:", error);
    return NextResponse.json({ error: "Failed to update chat session" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const result = await deleteChatSession(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[chatSessions] delete failed:", error);
    return NextResponse.json({ error: "Failed to delete chat session" }, { status: 500 });
  }
}
