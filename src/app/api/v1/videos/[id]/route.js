import { NextResponse } from "next/server";
import { getVideoJob, getVideoJobByTaskId, deleteVideoJob } from "@/lib/db/repos/videoJobsRepo";
import { pollVideoJob } from "open-sse/handlers/videoGeneration.js";

export const dynamic = "force-dynamic";

// GET /v1/videos/[id]
// Accept both numeric DB id and CodeBuddy taskId. Triggers a poll before
// responding so the caller sees the freshest status.
export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    let job = /^\d+$/.test(id) ? await getVideoJob(id) : await getVideoJobByTaskId(id);
    if (!job) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });

    // Refresh once if still pending
    if (job.status !== "completed" && job.status !== "failed") {
      await pollVideoJob(job.taskId).catch(() => {});
      job = await getVideoJob(job.id);
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("[videos/id] get failed:", error);
    return NextResponse.json({ error: { message: `Server error: ${error.message}` } }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const job = /^\d+$/.test(id) ? await getVideoJob(id) : await getVideoJobByTaskId(id);
    if (!job) return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
    await deleteVideoJob(job.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[videos/id] delete failed:", error);
    return NextResponse.json({ error: { message: `Server error: ${error.message}` } }, { status: 500 });
  }
}
