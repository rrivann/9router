// Next.js instrumentation hook — runs once per server process, before
// route handlers are loaded. Used to configure the global undici dispatcher
// so upstream provider requests (long-running SSE streams to CodeBuddy,
// , GPT, Gemini, etc.) don't get killed by undici's default 5-minute
// header/body timeouts and don't reuse a stale keep-alive socket that the
// upstream/LB has already half-closed (which surfaces as
// `TypeError: terminated` from Fetch.onAborted).
//
// Values below can be overridden via env:
//   UNDICI_HEADERS_TIMEOUT_MS   default 600000 (10 min)
//   UNDICI_BODY_TIMEOUT_MS      default 0      (no cap; stream stall guard
//                                              still enforced at app layer)
//   UNDICI_KEEPALIVE_TIMEOUT_MS default 30000  (30s idle before close)
//   UNDICI_KEEPALIVE_MAX_MS     default 600000 (max keep-alive lifetime)
//   UNDICI_CONNECT_TIMEOUT_MS   default 60000  (TCP+TLS handshake budget)

export async function register() {
  // Guard: Next also loads this in edge/browser contexts (harmless no-op there)
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { setGlobalDispatcher, Agent } = await import("undici");

    const envInt = (name, fallback) => {
      const raw = process.env[name];
      if (raw == null || raw === "") return fallback;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };

    const headersTimeout = envInt("UNDICI_HEADERS_TIMEOUT_MS", 600_000);
    const bodyTimeout = envInt("UNDICI_BODY_TIMEOUT_MS", 0);
    const keepAliveTimeout = envInt("UNDICI_KEEPALIVE_TIMEOUT_MS", 30_000);
    const keepAliveMaxTimeout = envInt("UNDICI_KEEPALIVE_MAX_MS", 600_000);
    const connectTimeout = envInt("UNDICI_CONNECT_TIMEOUT_MS", 60_000);

    setGlobalDispatcher(new Agent({
      headersTimeout,
      bodyTimeout,
      keepAliveTimeout,
      keepAliveMaxTimeout,
      connect: { timeout: connectTimeout },
    }));

    // eslint-disable-next-line no-console
    console.log(
      `[undici] global dispatcher configured · headers=${headersTimeout}ms body=${bodyTimeout}ms ` +
      `keepAlive=${keepAliveTimeout}/${keepAliveMaxTimeout}ms connect=${connectTimeout}ms`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[undici] instrumentation setup skipped: ${err.message}`);
  }
}
