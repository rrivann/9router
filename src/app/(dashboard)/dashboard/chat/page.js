"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Input } from "@/shared/components";

const LS = {
  model: "9r.chat-model",
  sys: "9r.chat-sys",
  active: "9r.chat-active",
};

const DEFAULT_SYSTEM = `You are a helpful assistant running inside the 9Router Gacor dashboard.
Reply in the same language the user writes in. Be concise and precise.`;

function loadLS(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function saveLS(key, value) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function deriveTitle(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function wireHistory(history, sys) {
  const out = history.map((m) => {
    if (m.role === "user" && Array.isArray(m.images) && m.images.length) {
      const parts = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const url of m.images) parts.push({ type: "image_url", image_url: { url } });
      return { role: "user", content: parts };
    }
    return { role: m.role, content: m.content };
  });
  if (sys && sys.trim()) out.unshift({ role: "system", content: sys.trim() });
  return out;
}

export default function ChatPage() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(() => loadLS(LS.active, null));
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(() => loadLS(LS.model, ""));
  const [sysPrompt, setSysPrompt] = useState(() => loadLS(LS.sys, DEFAULT_SYSTEM));
  const [showSys, setShowSys] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [attachments, setAttachments] = useState([]);

  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const fileRef = useRef(null);
  const loadedForRef = useRef(null);
  const videoPollersRef = useRef(new Map());

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch("/api/chat/sessions");
      const data = await r.json();
      setSessions(data?.sessions || []);
    } catch (e) {
      console.log("[chat] loadSessions:", e.message);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      // Use /api/models/catalog — exposes every kind (chat/image/video) with
      // metadata. /v1/models filters to LLM-only and skips media models.
      const r = await fetch("/api/models/catalog");
      const data = await r.json();
      const list = (data?.data || []).map((m) => ({ id: m.id, kind: m.kind || "chat" }));
      setModels(list);
      setModel((cur) => (cur && list.some((m) => m.id === cur) ? cur : list[0]?.id || ""));
    } catch {}
  }, []);

  useEffect(() => { loadSessions(); loadModels(); }, [loadSessions, loadModels]);
  useEffect(() => { if (model) saveLS(LS.model, model); }, [model]);
  useEffect(() => { saveLS(LS.sys, sysPrompt); }, [sysPrompt]);
  useEffect(() => {
    if (activeId == null) saveLS(LS.active, null);
    else saveLS(LS.active, activeId);
  }, [activeId]);

  const startVideoPoller = useCallback((taskId) => {
    if (!taskId || videoPollersRef.current.has(taskId)) return;
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/videos/${taskId}`);
        const job = await r.json();
        setMsgs((p) => p.map((m) => (m.video?.taskId === taskId
          ? { ...m, video: { ...m.video, status: job.status, url: job.url || null, resolution: job.resolution || null, seconds: job.seconds ?? null, credit: job.credit ?? null, errorMessage: job.errorMessage || null } }
          : m)));
        if (job.status === "completed" || job.status === "failed") {
          const h = videoPollersRef.current.get(taskId);
          if (h) clearInterval(h);
          videoPollersRef.current.delete(taskId);
        }
      } catch {}
    };
    const handle = setInterval(tick, 8000);
    videoPollersRef.current.set(taskId, handle);
    tick();
  }, []);

  useEffect(() => {
    if (activeId == null) {
      setMsgs([]);
      loadedForRef.current = null;
      return;
    }
    if (loadedForRef.current === activeId) return;
    loadedForRef.current = activeId;
    fetch(`/api/chat/sessions/${activeId}`)
      .then((r) => r.json())
      .then((data) => {
        const s = data?.session;
        if (!s) { setMsgs([]); return; }
        try {
          const parsed = s.messages ? JSON.parse(s.messages) : [];
          const arr = Array.isArray(parsed) ? parsed : [];
          setMsgs(arr);
          // Resume polling for any still-pending video jobs in this session.
          for (const m of arr) {
            if (m.video?.taskId && m.video.status !== "completed" && m.video.status !== "failed") {
              startVideoPoller(m.video.taskId);
            }
          }
        } catch { setMsgs([]); }
        if (s.model) setModel(s.model);
      })
      .catch(() => setMsgs([]));
  }, [activeId, startVideoPoller]);

  // Clear any active pollers when leaving the page.
  useEffect(() => () => {
    for (const h of videoPollersRef.current.values()) clearInterval(h);
    videoPollersRef.current.clear();
  }, []);

  // Persist when a turn settles.
  useEffect(() => {
    if (busy || activeId == null || loadedForRef.current !== activeId) return;
    const firstUser = msgs.find((m) => m.role === "user");
    const title = deriveTitle(firstUser?.content || "");
    const t = setTimeout(() => {
      fetch(`/api/chat/sessions/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          model,
          messages: JSON.stringify(msgs.slice(-200)),
          messageCount: msgs.length,
        }),
      })
        .then(loadSessions)
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [msgs, busy, activeId, model, loadSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: busy ? "auto" : "smooth",
    });
  }, [msgs, busy]);

  const callModel = useCallback(async (history, ac) => {
    const selected = models.find((m) => m.id === model);
    if (selected?.kind === "image") {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const prompt = (lastUser?.content || "").trim();
      if (!prompt) throw new Error("image generation needs a text prompt");
      const res = await fetch("/api/v1/images/generations", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `request failed (${res.status})`);
      const body = await res.json();
      const urls = (body?.data || [])
        .map((d) => d.url || (d.b64_json ? `data:image/png;base64,${d.b64_json}` : ""))
        .filter(Boolean);
      if (urls.length === 0) throw new Error("image response had no data");
      setMsgs((p) => [...p, { role: "assistant", content: "", images: urls }]);
      return;
    }

    if (selected?.kind === "video") {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const prompt = (lastUser?.content || "").trim();
      if (!prompt) throw new Error("video generation needs a text prompt");
      const res = await fetch("/api/v1/videos/generations", {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, seconds: 4, resolution: "720P", aspect_ratio: "16:9" }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `request failed (${res.status})`);
      const body = await res.json();
      const taskId = body?.task_id;
      if (!taskId) throw new Error("video submit returned no task_id");
      setMsgs((p) => [...p, {
        role: "assistant",
        content: "",
        video: { taskId, status: body.status || "queued", model, prompt, submittedAt: Date.now() },
      }]);
      startVideoPoller(taskId);
      return;
    }

    const res = await fetch("/api/chat/proxy", {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true, messages: wireHistory(history, sysPrompt) }),
    });
    if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `request failed (${res.status})`);

    const assistant = { role: "assistant", content: "" };
    setMsgs((p) => [...p, assistant]);

    let dirty = false;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      setMsgs((p) => [...p.slice(0, -1), { ...assistant }]);
    };
    const schedule = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") continue;
          let j;
          try { j = JSON.parse(data); } catch { continue; }
          const delta = j?.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) { assistant.content += delta.content; schedule(); }
          if (delta.reasoning_content) {
            assistant.reasoning = (assistant.reasoning || "") + delta.reasoning_content;
            schedule();
          }
        }
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
    }
    setMsgs((p) => [...p.slice(0, -1), { ...assistant }]);
  }, [model, models, sysPrompt]);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || !model) return;
    setErr("");
    let sid = activeId;
    if (sid == null) {
      try {
        const r = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, title: deriveTitle(text) }),
        });
        const data = await r.json();
        sid = data?.session?.id ?? null;
        if (sid != null) {
          loadedForRef.current = sid;
          setActiveId(sid);
        }
        loadSessions();
      } catch {}
    }
    setInput("");
    const imgs = attachments;
    setAttachments([]);

    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    const history = [
      ...msgs,
      { role: "user", content: text, images: imgs.length ? imgs : undefined },
    ];
    setMsgs(history);
    try {
      await callModel(history, ac);
    } catch (e) {
      if (e?.name !== "AbortError") setErr(e?.message || "failed");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, attachments, busy, model, activeId, msgs, callModel, loadSessions]);

  const stop = () => abortRef.current?.abort();
  const newChat = () => { stop(); setErr(""); setMsgs([]); loadedForRef.current = null; setActiveId(null); };
  const openChat = (id) => { if (id === activeId) return; stop(); setErr(""); setActiveId(id); };
  const deleteChat = async (id) => {
    await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === activeId) { setMsgs([]); loadedForRef.current = null; setActiveId(null); }
    loadSessions();
  };

  const pickImages = (files) => {
    if (!files) return;
    Array.from(files).slice(0, 4).forEach((f) => {
      if (!f.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => setAttachments((p) => [...p, String(reader.result)].slice(0, 6));
      reader.readAsDataURL(f);
    });
  };

  const activeTitle = useMemo(
    () => sessions.find((s) => s.id === activeId)?.title || "New chat",
    [sessions, activeId],
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-3 overflow-hidden">
      {sidebarOpen && (
        <aside className="flex w-60 shrink-0 flex-col rounded-xl border border-border-subtle bg-surface">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">History</span>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" icon="add" onClick={newChat}>New</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {(!sessions || sessions.length === 0) ? (
              <p className="p-3 text-center text-xs text-text-muted">No chats yet.</p>
            ) : (
              sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === activeId}
                  onOpen={() => openChat(s.id)}
                  onDelete={() => deleteChat(s.id)}
                />
              ))
            )}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border-subtle bg-surface">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide history" : "Show history"}
            className="rounded p-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              {sidebarOpen ? "left_panel_close" : "left_panel_open"}
            </span>
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{activeTitle}</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border border-border-subtle bg-surface-2/40 px-2 py-1 text-xs"
          >
            {models.length === 0 && <option>No models</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <button
            onClick={() => setShowSys((v) => !v)}
            title="System prompt"
            className={`rounded p-1 ${showSys ? "text-primary" : "text-text-muted"} hover:bg-black/5 dark:hover:bg-white/5`}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
          </button>
        </div>

        {showSys && (
          <div className="border-b border-border-subtle bg-surface-2/40 p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">System prompt</p>
            <textarea
              value={sysPrompt}
              onChange={(e) => setSysPrompt(e.target.value)}
              rows={4}
              className="w-full resize-y rounded border border-border-subtle bg-surface px-2 py-1.5 font-mono text-xs"
            />
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-text-muted">
                Start a conversation — messages route through your active CodeBuddy connections.
              </p>
            </div>
          )}
          {msgs.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {err && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {err}
            </div>
          )}
        </div>

        <div className="border-t border-border-subtle p-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((url, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="size-14 rounded border border-border-subtle object-cover" />
                  <button
                    onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                    className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-white"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[10px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder="Message… (Shift+Enter for newline)"
              disabled={busy}
              className="flex-1 resize-y rounded border border-border-subtle bg-surface-2/40 px-2 py-1.5 text-sm"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => { pickImages(e.target.files); e.target.value = ""; }}
            />
            <Button
              size="sm"
              variant="secondary"
              icon="image"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              title="Attach images"
            >
              Attach
            </Button>
            {busy ? (
              <Button size="sm" variant="secondary" icon="stop" onClick={stop}>Stop</Button>
            ) : (
              <Button size="sm" icon="send" onClick={send} disabled={!input.trim() && attachments.length === 0}>
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
        isUser ? "bg-primary/10 text-text-main" : "bg-surface-2/40 text-text-main"
      }`}>
        {message.reasoning && (
          <details className="mb-2 text-xs text-text-muted">
            <summary className="cursor-pointer select-none">Thinking</summary>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{message.reasoning}</pre>
          </details>
        )}
        {message.content && (
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        )}
        {Array.isArray(message.images) && message.images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.images.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt="" className="max-h-64 rounded border border-border-subtle" />
            ))}
          </div>
        )}
        {message.video && <VideoCard video={message.video} />}
      </div>
    </div>
  );
}

MessageBubble.propTypes = {
  message: PropTypes.shape({
    role: PropTypes.string.isRequired,
    content: PropTypes.string,
    reasoning: PropTypes.string,
    images: PropTypes.arrayOf(PropTypes.string),
    video: PropTypes.object,
  }).isRequired,
};

function VideoCard({ video }) {
  const { status, url, prompt, resolution, seconds, credit, errorMessage, submittedAt } = video;
  const elapsed = submittedAt ? Math.floor((Date.now() - submittedAt) / 1000) : null;
  if (status === "completed" && url) {
    return (
      <div className="mt-2">
        <video src={url} controls className="max-h-80 rounded border border-border-subtle" />
        <p className="mt-1 text-[10px] text-text-muted">
          {resolution} · {seconds}s{typeof credit === "number" ? ` · ${credit.toFixed(2)} credits` : ""}
        </p>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
        Video failed — {errorMessage || "unknown error"}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded border border-border-subtle bg-surface-2/40 px-3 py-2 text-xs text-text-muted">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
        <span>Rendering video… <span className="opacity-60">({status}{elapsed != null ? ` · ${elapsed}s` : ""})</span></span>
      </div>
      {prompt && <p className="mt-1 truncate italic opacity-75">“{prompt}”</p>}
    </div>
  );
}

VideoCard.propTypes = {
  video: PropTypes.shape({
    taskId: PropTypes.string,
    status: PropTypes.string,
    url: PropTypes.string,
    prompt: PropTypes.string,
    resolution: PropTypes.string,
    seconds: PropTypes.number,
    credit: PropTypes.number,
    errorMessage: PropTypes.string,
    submittedAt: PropTypes.number,
  }).isRequired,
};

function SessionRow({ session, active, onOpen, onDelete }) {
  return (
    <div className={`group flex items-center gap-1.5 rounded px-2 py-1.5 text-xs ${
      active ? "bg-primary/10 text-primary" : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
    }`}>
      <button onClick={onOpen} className="min-w-0 flex-1 truncate text-left" type="button">
        {session.title || "Untitled"}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500"
        title="Delete"
        type="button"
      >
        <span className="material-symbols-outlined text-[14px]">delete</span>
      </button>
    </div>
  );
}

SessionRow.propTypes = {
  session: PropTypes.shape({
    id: PropTypes.number.isRequired,
    title: PropTypes.string,
  }).isRequired,
  active: PropTypes.bool,
  onOpen: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};
