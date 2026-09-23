// 0penAI content → plain text helper. Kept here for legacy callers.
import { OPENAI_BLOCK } from "../schema/index.js";

export function extractTextContent(content, separator = "") {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === OPENAI_BLOCK.TEXT).map(c => c.text).join(separator);
  }
  return "";
}
