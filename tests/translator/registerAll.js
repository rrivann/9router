// Eagerly import every translator so register() side-effects run under ESM/vitest.
// translator/index.js uses require() (bundler-only) which no-ops in vitest → import directly.
import "../../open-sse/translator/request/claude-to-openai.js";
import "../../open-sse/translator/request/openai-to-claude.js";
import "../../open-sse/translator/request/openai-responses.js";
import "../../open-sse/translator/response/claude-to-openai.js";
import "../../open-sse/translator/response/openai-to-claude.js";
import "../../open-sse/translator/response/openai-responses.js";
