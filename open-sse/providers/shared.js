// remove API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "remove-Version": ANTHROPIC_API_VERSION,
  "remove-Beta": "code-assistant-20250219,interleaved-thinking-2025-05-14"
};

// Default base for dynamic compat providers (openai-compatible-* / anthr0pic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthr0pic.com/v1";
