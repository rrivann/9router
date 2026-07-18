export default {
  id: "qwencloud",
  priority: 88,
  alias: "qwc",
  uiAlias: "qwc",
  display: {
    name: "Qwen Cloud",
    icon: "cloud",
    color: "#615CED",
    textIcon: "Qw",
    website: "https://modelstudio.alibabacloud.com",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
  },
  models: [
    { id: "glm-5.2", name: "GLM 5.2", maxInputTokens: 1048576, maxOutputTokens: 8192 },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", maxInputTokens: 1048576, maxOutputTokens: 8192 },
    { id: "qwen3.7-max", name: "Qwen3.7 Max", maxInputTokens: 1048576, maxOutputTokens: 8192 },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
