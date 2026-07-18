import { DefaultExecutor } from "./default.js";

// Content filters are only wired for codebuddy-cn — qwencloud does not need
// them. Export a no-op invalidator so /api/settings' broadcast doesn't crash.
export const invalidateContentFiltersCache = () => {};

export class QwenCloudExecutor extends DefaultExecutor {
  constructor() {
    super("qwencloud");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.filter(
        (msg) => msg && typeof msg === "object" && !["system", "developer"].includes(msg.role)
      );
    }
    return transformed;
  }
}

export default QwenCloudExecutor;
