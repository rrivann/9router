// Role enums — fixed per format. Pure data (no logic).
// OpenAI chat / Claude share these; mapping between them stays in translators.

export const ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
  SYSTEM: "system",
  DEVELOPER: "developer",
};
