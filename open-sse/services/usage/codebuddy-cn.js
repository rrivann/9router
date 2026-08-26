/**
 * CodeBuddy CN usage handler
 *
 * Quota tracker disabled — no Tencent billing API call.
 * See 9router_CodeBuddy_Security_Fix_Guide.md for rationale.
 */

export async function getCodeBuddyCnUsage() {
  return { message: "Quota tracking disabled." };
}
