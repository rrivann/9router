import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const proxyFetchMock = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => proxyFetchMock(...args),
}));

// Import after mock registration.
const { emitCodebuddyReport, deriveMachineId } = await import(
  "../../open-sse/services/codebuddyReport.js"
);

function makeJwt(payload) {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS512", typ: "JWT" })}.${b64(payload)}.sig`;
}

const providerHeaders = {
  "X-Conversation-ID": "abcd1234-5678-90ef-abcd-123456789012",
  "X-Conversation-Request-ID": "0000root00000000000000000000root",
  "X-Conversation-Message-ID": "0000msg00000000000000000000000ms",
  "Authorization": "Bearer JWT",
};

const credentials = {
  accessToken: makeJwt({ sub: "user-abc-123" }),
  connectionId: "conn-fixed",
};

const transformedBody = {
  model: "default-model",
  messages: [
    { role: "system", content: "You are CodeBuddy." },
    { role: "user", content: "hi there" },
  ],
};

beforeEach(() => {
  proxyFetchMock.mockReset();
  proxyFetchMock.mockResolvedValue({ ok: true, status: 200 });
  delete process.env.CODEBUDDY_EMIT_REPORT;
});

afterEach(() => {
  delete process.env.CODEBUDDY_EMIT_REPORT;
});

describe("emitCodebuddyReport — gating", () => {
  it("does NOT fetch when env is unset AND enabled is unset", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it("does NOT fetch when CODEBUDDY_EMIT_REPORT='0' and enabled is false", () => {
    process.env.CODEBUDDY_EMIT_REPORT = "0";
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      enabled: false,
      baseUrl: "https://www.codebuddy.ai",
    });
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it("DOES fetch when enabled=true (dashboard toggle) even without env", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      enabled: true,
      baseUrl: "https://www.codebuddy.ai",
    });
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
  });

  it("DOES fetch when env='1' even without enabled arg (env fallback)", () => {
    process.env.CODEBUDDY_EMIT_REPORT = "1";
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT fetch when providerHeaders is missing even if enabled=true", () => {
    emitCodebuddyReport({
      providerHeaders: null,
      credentials,
      transformedBody,
      enabled: true,
      baseUrl: "https://www.codebuddy.ai",
    });
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it("falls back to realm baseUrl when baseUrl arg is missing", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      enabled: true,
      baseUrl: null,
    });
    // Default realm = codebuddy, so target still resolves cleanly.
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    expect(proxyFetchMock.mock.calls[0][0]).toBe("https://www.codebuddy.ai/v2/report");
  });
});

describe("emitCodebuddyReport — payload shape", () => {
  beforeEach(() => {
    process.env.CODEBUDDY_EMIT_REPORT = "1";
  });

  it("fires POST to /v2/report with 3-event batch", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });

    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = proxyFetchMock.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/report");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    expect(body[0].eventCode).toBe("plugin_status");
    expect(body[1].eventCode).toBe("chat_request_send");
    expect(body[2].eventCode).toBe("chat_message_send");
  });

  it("reuses X-Conversation-* IDs from providerHeaders", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    const body = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    expect(body[1].conversationId).toBe(providerHeaders["X-Conversation-ID"]);
    expect(body[1].requestId).toBe(providerHeaders["X-Conversation-Request-ID"]);
    expect(body[1]["codebuddy.session_id"]).toBe(providerHeaders["X-Conversation-ID"]);
    expect(body[1]["codebuddy.conversation_request_id"]).toBe(providerHeaders["X-Conversation-Request-ID"]);
    expect(body[2].messageId).toBe(providerHeaders["X-Conversation-Message-ID"]);
  });

  it("sends prompt length as inputLength from last user message string", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    const body = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    expect(body[1].inputLength).toBe("hi there".length);
  });

  it("sums text parts when user content is array-of-text", () => {
    const bodyMulti = {
      messages: [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "text", text: "world" },
          ],
        },
      ],
    };
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody: bodyMulti,
      baseUrl: "https://www.codebuddy.ai",
    });
    const payload = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    expect(payload[1].inputLength).toBe("hello".length + "world".length);
  });

  it("derives userId from JWT sub claim", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    const body = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    body.forEach((event) => expect(event.userId).toBe("user-abc-123"));
  });

  it("derives empty userId for API key credentials (ck_/pt_)", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials: { apiKey: "ck_notajwt", connectionId: "c" },
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    const body = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    expect(body[0].userId).toBe("");
  });

  it("stamps CLI 2.144.0 fingerprint fields on every event", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    const body = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    for (const event of body) {
      expect(event.ideName).toBe("CLI");
      expect(event.ideType).toBe("CLI");
      expect(event.ideVersion).toBe("2.144.0");
      expect(event.extName).toBe("@tencent-ai/codebuddy-code");
      expect(event.extVersion).toBe("2.144.0");
      expect(event.product).toBe("SaaS");
    }
  });

  it("strips SSE Accept + gzip Content-Encoding from report headers", () => {
    emitCodebuddyReport({
      providerHeaders: {
        ...providerHeaders,
        Accept: "text/event-stream",
        "Content-Encoding": "gzip",
      },
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai",
    });
    const opts = proxyFetchMock.mock.calls[0][1];
    expect(opts.headers.Accept).toBe("application/json");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers["Content-Encoding"]).toBeUndefined();
  });

  it("trims trailing slash on baseUrl", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials,
      transformedBody,
      baseUrl: "https://www.codebuddy.ai/",
    });
    expect(proxyFetchMock.mock.calls[0][0]).toBe("https://www.codebuddy.ai/v2/report");
  });

  it("switches URL + fingerprint to workbuddy when realm is workbuddy", () => {
    emitCodebuddyReport({
      providerHeaders,
      credentials: {
        ...credentials,
        providerSpecificData: { realm: "workbuddy" },
      },
      transformedBody,
      // no baseUrl override — realm resolver picks it
    });
    expect(proxyFetchMock.mock.calls[0][0]).toBe("https://www.workbuddy.ai/v2/report");
    const body = JSON.parse(proxyFetchMock.mock.calls[0][1].body);
    expect(body[0].ideName).toBe("WorkBuddy");
    expect(body[0].ideVersion).toBe("5.5.2");
    expect(body[0].extName).toBe("workbuddy-desktop");
    expect(body[0].featureModule).toBe("wb_desktop");
  });
});

describe("deriveMachineId", () => {
  it("is stable for the same connectionId", () => {
    expect(deriveMachineId("abc")).toBe(deriveMachineId("abc"));
  });

  it("is different for different connectionIds", () => {
    expect(deriveMachineId("abc")).not.toBe(deriveMachineId("xyz"));
  });

  it("returns UUID-shape uppercase hex", () => {
    const id = deriveMachineId("some-connection-id");
    expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  });

  it("uses a stable placeholder when connectionId is missing", () => {
    expect(deriveMachineId(null)).toBe(deriveMachineId(undefined));
    expect(deriveMachineId("")).toBe(deriveMachineId(null));
  });
});
