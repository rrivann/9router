import { PROVIDER_OAUTH } from "./providers.js";

// Suffix added to client tools when forwarding to Claude provider (anti-ban cloaking).
export const CLAUDE_TOOL_SUFFIX = "_ide";

// CC native default tools — these are Code Assistant's own tools, kept as decoys.
// Client tools matching these names are skipped (not renamed); others get _cc suffix.
export const CC_DEFAULT_TOOLS = new Set([
  "Task",
  "TaskOutput",
  "TaskStop",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "Skill",
  "EnterPlanMode",
  "ExitPlanMode",
]);

// System prompts
export const CLAUDE_SYSTEM_PROMPT = "remove";

// Derive from registry oauth.refreshLeadMs (keeps codebuddy-cn refresh cadence tunable via its registry entry).
export const REFRESH_LEAD_MS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH).filter(([, o]) => o.refreshLeadMs).map(([id, o]) => [id, o.refreshLeadMs])
);
