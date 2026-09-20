import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { CodeBuddyGlobalExecutor } from "./codebuddy.js";
import { DefaultExecutor } from "./default.js";

const executors = {
  "codebuddy-cn": new CodeBuddyExecutor(),
  codebuddy: new CodeBuddyGlobalExecutor(),
};

const defaultCache = new Map();

export function getExecutor(provider) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  return !!executors[provider];
}

export { BaseExecutor } from "./base.js";
export { DefaultExecutor } from "./default.js";
export { CodeBuddyExecutor } from "./codebuddy-cn.js";
export { CodeBuddyGlobalExecutor } from "./codebuddy.js";
