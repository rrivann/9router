/**
 * Qwen Cloud usage handler
 *
 * Quota tracker disabled — no local DB query.
 */

export async function getQwenCloudUsage() {
  return { message: "Quota tracking disabled." };
}
