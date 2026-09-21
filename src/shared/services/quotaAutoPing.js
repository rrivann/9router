// Quota auto-ping scheduler — no-op in the CodeBuddy-only fork.
// Original scheduler warmed 5h windows for Claude / Codex providers, both removed.

export function startQuotaAutoPing() {
  // no-op
}

export function stopQuotaAutoPing() {
  // no-op
}

export function isQuotaAutoPingRunning() {
  return false;
}

export function configureQuotaAutoPing() {
  // no-op
}
