/**
 * Append-only audit log — durable with the session store.
 * NEVER fed back into the LLM. Debug / ops / Albert demo evidence only.
 *
 * Event shape:
 * {
 *   id, ts, type,
 *   phase, name, age, dueAt,
 *   ...payload
 * }
 */

import { randomUUID } from "node:crypto";
import {
  appendSessionEvent,
  listSessionEvents,
  listSessionIndex,
  upsertSessionIndex,
  getSession,
} from "./store.js";

const MAX_TEXT = 2000;

function clip(s) {
  const t = String(s ?? "");
  if (t.length <= MAX_TEXT) return t;
  return `${t.slice(0, MAX_TEXT)}…`;
}

function snapshot(session) {
  if (!session) return {};
  return {
    phase: session.phase ?? null,
    name: session.name ?? null,
    age: session.age ?? null,
    dueAt: session.dueAt ?? null,
    engagement: session.engagement ?? null,
    openThread: session.openThread ?? null,
    llmCalls: session.metrics?.llmCalls ?? null,
    inputTokens: session.metrics?.inputTokens ?? null,
    outputTokens: session.metrics?.outputTokens ?? null,
    latenessMs: session.metrics?.latenessMs ?? null,
  };
}

export async function audit(session, type, payload = {}) {
  if (!session?.id) return null;
  const event = {
    id: randomUUID(),
    ts: Date.now(),
    type,
    ...snapshot(session),
    ...sanitizePayload(payload),
  };
  await appendSessionEvent(session.id, event);
  await upsertSessionIndex(session);
  return event;
}

function sanitizePayload(payload) {
  const out = { ...payload };
  if (out.text != null) out.text = clip(out.text);
  if (out.userText != null) out.userText = clip(out.userText);
  if (out.content != null) out.content = clip(out.content);
  if (out.providerReply != null) out.providerReply = clip(out.providerReply);
  if (out.deferred != null) out.deferred = clip(out.deferred);
  if (Array.isArray(out.messages)) {
    out.messages = out.messages.map((m) => ({
      role: m.role,
      kind: m.kind,
      source: m.source,
      content: clip(m.content),
      route: m.route,
    }));
  }
  return out;
}

/** After a turn returns — one structured row for the whole exchange. */
export async function auditTurn(sessionId, userText, out) {
  const session = await getSession(sessionId);
  if (!session) return;
  await audit(session, "turn", {
    userText,
    route: out.route || null,
    resultPhase: out.phase || session.phase,
    messages: out.messages || [],
  });
}

export async function getAuditTrail(sessionId) {
  return listSessionEvents(sessionId);
}

export async function getSessionDirectory(limit = 50) {
  return listSessionIndex(limit);
}
