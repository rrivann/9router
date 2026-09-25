import { AsyncLocalStorage } from "async_hooks";
import { DefaultExecutor } from "./default.js";
import {
  createContentFilterCache,
  applyFiltersToMessages,
} from "../utils/contentFilters.js";

const filters = createContentFilterCache("codebuddy-cn");
export const invalidateContentFiltersCache = filters.invalidate;

// Per-request state — see codebuddy.js for rationale (singleton executor +
// concurrent requests would race on instance fields).
const requestState = new AsyncLocalStorage();

export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  async execute(params) {
    const state = { contentFilters: await filters.load(), filtersApplied: null };
    return requestState.run(state, async () => {
      const result = await super.execute(params);
      if (state.filtersApplied) result.filtersApplied = state.filtersApplied;
      return result;
    });
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

    const state = requestState.getStore();
    const rules = state?.contentFilters || [];
    if (rules.length > 0 && Array.isArray(transformed.messages)) {
      const result = applyFiltersToMessages(transformed.messages, rules);
      transformed.messages = result.messages;
      if (result.applied.length > 0 && state) state.filtersApplied = result.applied;
    }

    return transformed;
  }
}

export default CodeBuddyExecutor;
