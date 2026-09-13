const http = require("http");

// ─── Undici global dispatcher (Opsi B) ─────────────────────────────────────
// Belt-and-suspenders alongside `instrumentation.js`. Ensures the process-wide
// fetch (undici) uses long-tolerant timeouts and short keep-alive so upstream
// providers that half-close idle sockets can't surface as
// `TypeError: terminated` mid-stream. Values match instrumentation.js.
try {
  const { setGlobalDispatcher, Agent, getGlobalDispatcher } = require("undici");
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
  const prev = getGlobalDispatcher && getGlobalDispatcher();
  const isDefaultAgent = !prev || prev.constructor?.name === "Agent";
  if (isDefaultAgent) {
    setGlobalDispatcher(new Agent({
      headersTimeout,
      bodyTimeout,
      keepAliveTimeout,
      keepAliveMaxTimeout,
      connect: { timeout: connectTimeout },
    }));
    // eslint-disable-next-line no-console
    console.log(
      `[undici] global dispatcher configured (custom-server) · headers=${headersTimeout}ms body=${bodyTimeout}ms ` +
      `keepAlive=${keepAliveTimeout}/${keepAliveMaxTimeout}ms connect=${connectTimeout}ms`,
    );
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`[undici] custom-server dispatcher setup skipped: ${err.message}`);
}

const origCreate = http.createServer.bind(http);

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers only when the TCP peer is a local reverse proxy.
    // Direct/public sockets remain keyed by the unspoofable peer address.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    req.headers["x-9r-real-ip"] = ip;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  return origCreate(...rest, wrapped);
};

require("./server.js");
