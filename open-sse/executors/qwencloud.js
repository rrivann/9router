import { DefaultExecutor } from "./default.js";
import {
  createContentFilterCache,
  applyFiltersToMessages,
} from "../utils/contentFilters.js";

const filters = createContentFilterCache("qwencloud");
export const invalidateContentFiltersCache = filters.invalidate;

export class QwenCloudExecutor extends DefaultExecutor {
  constructor() {
    super("qwencloud");
  }

  async execute(params) {
    this._contentFilters = await filters.load();
    return super.execute(params);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.filter(
        (msg) => msg && typeof msg === "object" && !["system", "developer"].includes(msg.role)
      );
    }
    const rules = this._contentFilters || [];
    if (rules.length > 0 && Array.isArray(transformed.messages)) {
      transformed.messages = applyFiltersToMessages(transformed.messages, rules);
    }
    return transformed;
  }
}

export default QwenCloudExecutor;
