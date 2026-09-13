import { DefaultExecutor } from "./default.js";
import {
  createContentFilterCache,
  applyFiltersToMessages,
} from "../utils/contentFilters.js";

const filters = createContentFilterCache("codebuddy-cn");
export const invalidateContentFiltersCache = filters.invalidate;

export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  async execute(params) {
    this._contentFilters = await filters.load();
    return super.execute(params);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    // CodeBuddy backend types tool_choice as string only — coerce object form to "required"
    if (transformed.tool_choice && typeof transformed.tool_choice === "object") {
      transformed.tool_choice = "required";
    }

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    const rules = this._contentFilters || [];
    if (rules.length > 0 && Array.isArray(transformed.messages)) {
      transformed.messages = applyFiltersToMessages(transformed.messages, rules);
    }

    return transformed;
  }
}

export default CodeBuddyExecutor;
