"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatRemaining(dueAt) {
  if (!dueAt) return null;
  const total = Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Page() {
  const [sessionId, setSessionId] = useState(null);
  const [phase, setPhase] = useState("boot");
  const [dueAt, setDueAt] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [now, setNow] = useState(Date.now());
  const [debugOpen, setDebugOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [events, setEvents] = useState([]);
  const deliveredRef = useRef(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const pinnedRef = useRef(true);

  const push = useCallback((msg) => {
    setMessages((m) => [...m, msg]);
  }, []);

  /**
   * column-reverse log: scrollTop === 0 is the visual bottom (latest).
   * ChatGPT-style stick-to-bottom without fighting the browser.
   */
  const stickLatest = useCallback((force = false) => {
    const el = logRef.current;
    if (!el) return;
    if (!force && !pinnedRef.current) return;
    el.scrollTop = 0;
  }, []);

  const tryDeliver = useCallback(
    async (id) => {
      if (!id || deliveredRef.current) return;
      const res = await fetch(`/api/session/${id}/deliver`, { method: "POST" });
      const data = await res.json();
      if (data.delivered) {
        deliveredRef.current = true;
        setPhase(data.phase);
        setMetrics(data.metrics);
        for (const m of data.messages || []) push(m);
      }
    },
    [push]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved =
        typeof window !== "undefined"
          ? window.localStorage.getItem("sara.sessionId")
          : null;

      if (saved) {
        const resume = await fetch(`/api/session/${saved}`);
        const data = await resume.json();
        if (!cancelled && resume.ok && data.session) {
          const s = data.session;
          if (s.phase !== "DONE") {
            setSessionId(s.id);
            setPhase(s.phase);
            setDueAt(s.dueAt || null);
            setMetrics(data.metrics || null);
            deliveredRef.current = s.phase === "NEED_AGE" || s.phase === "DONE";
            push({
              role: "system",
              content: s.dueAt
                ? `Resumed · ${s.phase} · wait ${s.delayLabel || "armed"}`
                : `Resumed · ${s.phase}${s.name ? ` · ${s.name}` : ""}`,
              kind: "system",
            });
            if (s.phase === "NEED_AGE") {
              push({
                role: "assistant",
                content: "Welcome back — how old are you?",
                kind: "deferred_age_ask",
              });
            } else if (s.phase === "NEED_TIME") {
              push({
                role: "assistant",
                content: `Hi${s.name ? ` ${s.name}` : ""}! How much time do you need?`,
                kind: "ask_time",
              });
            } else if (s.phase === "NEED_NAME") {
              push({
                role: "assistant",
                content: "What's your name?",
                kind: "ask_name",
              });
            } else if (s.phase === "CHATTING") {
              push({
                role: "assistant",
                content: `Still here${s.name ? `, ${s.name}` : ""}. We can chat until the timer fires.`,
                kind: "chat",
              });
            }
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              stickLatest(true);
            });
            return;
          }
        }
      }

      const res = await fetch("/api/session", { method: "POST" });
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        push({
          role: "assistant",
          content: data.error || "boot failed",
          kind: "error",
        });
        setPhase("error");
        return;
      }
      setSessionId(data.sessionId);
      try {
        window.localStorage.setItem("sara.sessionId", data.sessionId);
      } catch {
        /* ignore */
      }
      setPhase(data.phase);
      setMetrics(data.metrics);
      setModel(data.model || "");
      for (const m of data.messages || []) push(m);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        stickLatest(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [push, stickLatest]);

  useEffect(() => {
    if (!sessionId || !dueAt || phase !== "CHATTING") return;
    const delay = Math.max(0, dueAt - Date.now());
    const t = setTimeout(() => tryDeliver(sessionId), delay);
    const retry = setTimeout(() => tryDeliver(sessionId), delay + 750);
    return () => {
      clearTimeout(t);
      clearTimeout(retry);
    };
  }, [sessionId, dueAt, phase, tryDeliver]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    stickLatest(false);
  }, [messages, busy, stickLatest]);

  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    // In column-reverse, near 0 = following latest.
    const atLatest = el.scrollTop < 72;
    pinnedRef.current = atLatest;
    setPinned(atLatest);
  }

  async function onSend(e) {
    e.preventDefault();
    if (!text.trim() || !sessionId || busy) return;
    const value = text.trim();
    setText("");
    pinnedRef.current = true;
    setPinned(true);
    push({ role: "user", content: value });
    stickLatest(true);
    setBusy(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        push({
          role: "assistant",
          content: data.error || "error",
          kind: "error",
        });
      } else {
        setPhase(data.phase);
        if (data.dueAt) {
          setDueAt(data.dueAt);
          deliveredRef.current = false;
        }
        try {
          if (sessionId) window.localStorage.setItem("sara.sessionId", sessionId);
        } catch {
          /* ignore */
        }
        setMetrics(data.metrics);
        for (const m of data.messages || []) push(m);
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        stickLatest(true);
      });
    }
  }

  const remaining = useMemo(() => {
    void now;
    if (phase === "CHATTING" && dueAt) return formatRemaining(dueAt);
    if (phase === "NEED_AGE") return "DUE";
    if (phase === "DONE") return "DONE";
    return null;
  }, [phase, dueAt, now]);

  useEffect(() => {
    if (!debugOpen || !sessionId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/session/${sessionId}/events`);
      const data = await res.json();
      if (!cancelled && res.ok) setEvents(data.events || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [debugOpen, sessionId, messages, phase, metrics]);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span>Timed agent</span>
          <h1>Chat</h1>
        </div>
        <div
          className={`chrono${remaining ? " live" : " idle"}`}
          aria-live="polite"
        >
          <small>
            {phase === "NEED_AGE"
              ? "Age"
              : phase === "NEED_TIME"
                ? "Time"
                : phase === "DONE"
                  ? "Done"
                  : remaining
                    ? "Live"
                    : "Countdown"}
          </small>
          <strong>
            {phase === "NEED_AGE"
              ? "ask"
              : phase === "NEED_TIME"
                ? "pick"
                : phase === "DONE"
                  ? "ok"
                  : (remaining ?? "—")}
          </strong>
        </div>
      </header>

      <div className="rail">
        <div className="stat">
          <b>Phase</b>
          <em>{phase}</em>
        </div>
        <div className="stat">
          <b>LLM</b>
          <em>{metrics?.llmCalls ?? "—"}</em>
        </div>
        <div className="stat">
          <b>Tokens</b>
          <em>
            {metrics
              ? `${metrics.inputTokens}/${metrics.outputTokens}`
              : "—"}
          </em>
        </div>
        <div className="stat">
          <b>Late</b>
          <em>
            {metrics?.latenessMs != null ? `${metrics.latenessMs}ms` : "—"}
          </em>
        </div>
      </div>

      <section className="stage">
        <div className="log" ref={logRef} onScroll={onLogScroll}>
          <div className="log-stack">
            {messages.map((m, i) =>
              m.role === "system" ? (
                <div key={i} className="sys">
                  {m.content}
                </div>
              ) : (
                <div
                  key={i}
                  className={`row ${m.role}${m.kind === "error" ? " error" : ""}`}
                >
                  <div className="bubble">{m.content}</div>
                </div>
              )
            )}
            {busy ? (
              <div className="typing" aria-live="polite">
                <span className="typing-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span>Thinking…</span>
              </div>
            ) : null}
          </div>
        </div>

        {!pinned ? (
          <button
            type="button"
            className="jump"
            onClick={() => {
              pinnedRef.current = true;
              setPinned(true);
              stickLatest(true);
            }}
          >
            Latest ↓
          </button>
        ) : null}

        <form className="composer" onSubmit={onSend}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={true}
            disabled={!sessionId}
          />
          <button type="submit" disabled={!sessionId || busy || !text.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </form>
      </section>

      <footer className="foot">
        <button type="button" onClick={() => setDebugOpen((v) => !v)}>
          {debugOpen ? "Hide debug" : "Debug"}
        </button>
        {debugOpen ? (
          <div className="meta">
            <span>{model || "model?"}</span>
            <span>{sessionId ? sessionId.slice(0, 8) : "—"}</span>
            <span>{messages.at(-1)?.kind || "—"}</span>
            <span>{events.length} events</span>
          </div>
        ) : (
          <span>{model || ""}</span>
        )}
      </footer>

      {debugOpen ? (
        <div className="audit">
          <div className="audit-head">
            <b>Audit log</b>
            <span>DB trail · not sent to LLM</span>
          </div>
          <pre className="audit-body">
            {events.length
              ? events
                  .map((e) => {
                    const t = new Date(e.ts).toISOString().slice(11, 19);
                    const bit =
                      e.text ||
                      e.userText ||
                      e.content ||
                      e.ask ||
                      e.route ||
                      e.name ||
                      e.age ||
                      "";
                    return `${t}  ${e.type}${e.route ? ` [${e.route}]` : ""}${
                      bit ? `  ${String(bit).slice(0, 80)}` : ""
                    }`;
                  })
                  .join("\n")
              : "No events yet."}
          </pre>
        </div>
      ) : null}
    </div>
  );
}