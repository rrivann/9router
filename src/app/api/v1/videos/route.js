import { NextResponse } from "next/server";
import { listVideoJobs } from "@/lib/db/repos/videoJobsRepo";

export const dynamic = "force-dynamic";

// GET /v1/videos — list recent video jobs (dashboard use)
export async function GET() {
  try {
    const jobs = await listVideoJobs({ limit: 50 });
    return NextResponse.json({ data: jobs });
  } catch (error) {
    console.error("[videos] list failed:", error);
    return NextResponse.json({ error: "Failed to list video jobs" }, { status: 500 });
  }
}
