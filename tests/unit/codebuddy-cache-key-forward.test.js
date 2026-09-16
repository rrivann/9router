import { describe, expect, it } from "vitest";

const { CodeBuddyGlobalExecutor } =
  await import("../../open-sse/executors/codebuddy.js");

describe("CodeBuddy executor forwards cache-grouping keys", () => {
  it("transformRequest keeps prompt_cache_key from the translated body", () => {
    const exec = new CodeBuddyGlobalExecutor();
    const out = exec.transformRequest("gpt-6-astra", {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hi" }],
      prompt_cache_key: "stable-cache-key",
    });

    expect(out.prompt_cache_key).toBe("stable-cache-key");
  });

  it("transformRequest keeps the user field as cache-grouping fallback", () => {
    const exec = new CodeBuddyGlobalExecutor();
    const out = exec.transformRequest("gpt-6-astra", {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hi" }],
      user: "some-user-id",
    });

    expect(out.user).toBe("some-user-id");
  });

  it("does not invent keys when the client sent none", () => {
    const exec = new CodeBuddyGlobalExecutor();
    const out = exec.transformRequest("gpt-6-astra", {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(out.prompt_cache_key).toBeUndefined();
    expect(out.user).toBeUndefined();
  });
});
