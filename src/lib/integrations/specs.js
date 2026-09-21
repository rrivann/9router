/**
 * Integrations — CLI tool snippet generators.
 *
 * Snippet-only (no filesystem writes): each spec knows how to emit config
 * fragments (JSON/TOML/YAML/ENV) that the user copies into their tool's
 * config file. Every generator receives { baseUrl, apiKey, models } where
 * baseUrl is the fork's public gateway origin (WITHOUT trailing /v1) and
 * models is a non-empty array of "<providerAlias>/<modelId>" strings.
 *
 * Fork exposes:
 *   - 0penAI-compatible chat:      <base>/v1/chat/completions
 *   - remove Messages-compatible:  <base>/v1/messages
 * Both share the same API key.
 */

const withV1 = (base) => {
  const b = String(base || "").trim().replace(/\/+$/, "");
  if (!b) return "http://localhost:20128/v1";
  return b.endsWith("/v1") ? b : `${b}/v1`;
};
const withoutV1 = (base) => {
  const b = String(base || "").trim().replace(/\/+$/, "");
  if (!b) return "http://localhost:20128";
  return b.replace(/\/v1$/, "");
};

// --- generators (return array of { path, format, content }) ---

function claudeCode({ baseUrl, apiKey, models }) {
  const anthropicBase = withoutV1(baseUrl); // Code Assistant auto-appends /v1/messages
  return [
    {
      path: "~/.claude/settings.json",
      format: "json",
      content: JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: anthropicBase,
            ANTHROPIC_AUTH_TOKEN: apiKey,
            ANTHROPIC_MODEL: models[0],
          },
        },
        null,
        2,
      ),
    },
  ];
}

function claudeCowork({ baseUrl, apiKey, models }) {
  return [
    {
      path: "~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json",
      format: "json",
      content: JSON.stringify(
        {
          inferenceProvider: "gateway",
          inferenceGatewayBaseUrl: withV1(baseUrl),
          inferenceGatewayApiKey: apiKey,
          inferenceModels: models.map((m) => ({ name: m })),
        },
        null,
        2,
      ),
    },
  ];
}

function codex({ baseUrl, apiKey, models }) {
  const base = withV1(baseUrl);
  const providerBlock = [
    "[model_providers.9router]",
    `name = "9router-gacor"`,
    `base_url = "${base}"`,
    `env_key = "NINEROUTER_API_KEY"`,
    "",
    `model_provider = "9router"`,
    `model = "${models[0]}"`,
  ].join("\n");
  return [
    { path: "~/.codex/config.toml", format: "toml", content: providerBlock },
    {
      path: "~/.codex/auth.json",
      format: "json",
      content: JSON.stringify({ NINEROUTER_API_KEY: apiKey }, null, 2),
    },
  ];
}

function opencode({ baseUrl, apiKey, models }) {
  const base = withV1(baseUrl);
  const modelsMap = Object.fromEntries(models.map((m) => [m, { name: m }]));
  return [
    {
      path: "~/.config/opencode/opencode.json",
      format: "json",
      content: JSON.stringify(
        {
          provider: {
            "9router": {
              npm: "@ai-sdk/openai-compatible",
              options: { baseURL: base, apiKey },
              models: modelsMap,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

function openclaw({ baseUrl, apiKey, models }) {
  const base = withV1(baseUrl);
  const modelsMap = Object.fromEntries(models.map((m) => [m, { name: m }]));
  return [
    {
      path: "~/.openclaw/openclaw.json",
      format: "json",
      content: JSON.stringify(
        {
          providers: {
            "9router": {
              baseURL: base,
              apiKey,
              models: modelsMap,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

function hermes({ baseUrl, apiKey, models }) {
  const base = withV1(baseUrl);
  const yaml = [
    "provider: 9router",
    "providers:",
    "  9router:",
    `    base_url: ${base}`,
    "    api_key: ${NINEROUTER_API_KEY}",
    `    model: ${models[0]}`,
  ].join("\n");
  return [
    { path: "~/.hermes/config.yaml", format: "yaml", content: yaml },
    {
      path: "~/.hermes/.env",
      format: "env",
      content: `NINEROUTER_API_KEY=${apiKey}\n`,
    },
  ];
}

// --- registry ---

export const INTEGRATION_SPECS = [
  {
    key: "claude",
    name: "Code Assistant",
    binary: "claude",
    multiModel: false,
    configPaths: ["~/.claude/settings.json"],
    generate: claudeCode,
    homepage: "https://claude.com/code-assistant",
  },
  {
    key: "cowork",
    name: "Claude Cowork",
    binary: "cowork",
    multiModel: true,
    configPaths: ["~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json"],
    generate: claudeCowork,
    homepage: "https://claude.com/cowork",
  },
  {
    key: "openclaw",
    name: "Open Claw",
    binary: "openclaw",
    multiModel: true,
    configPaths: ["~/.openclaw/openclaw.json"],
    generate: openclaw,
  },
  {
    key: "opencode",
    name: "OpenCode",
    binary: "opencode",
    multiModel: true,
    configPaths: ["~/.config/opencode/opencode.json"],
    generate: opencode,
    homepage: "https://opencode.ai",
  },
  {
    key: "hermes",
    name: "Hermes",
    binary: "hermes",
    multiModel: false,
    configPaths: ["~/.hermes/config.yaml", "~/.hermes/.env"],
    generate: hermes,
  },
  {
    key: "codex",
    name: "OpenAI Codex CLI",
    binary: "codex",
    multiModel: false,
    configPaths: ["~/.codex/config.toml", "~/.codex/auth.json"],
    generate: codex,
    homepage: "https://github.com/openai/codex",
  },
];

export function getIntegrationSpec(key) {
  return INTEGRATION_SPECS.find((s) => s.key === key) || null;
}

export function listPublicSpecs() {
  return INTEGRATION_SPECS.map((s) => ({
    key: s.key,
    name: s.name,
    binary: s.binary,
    multiModel: s.multiModel,
    configPaths: s.configPaths,
    homepage: s.homepage || null,
  }));
}

export function generateSnippet(key, params) {
  const spec = getIntegrationSpec(key);
  if (!spec) return null;
  const models = Array.isArray(params?.models) ? params.models.filter(Boolean) : [];
  if (models.length === 0) return null;
  return spec.generate({
    baseUrl: params.baseUrl || "http://localhost:20128",
    apiKey: params.apiKey || "sk-…",
    models,
  });
}
