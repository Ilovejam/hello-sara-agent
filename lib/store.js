import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * Durable session store.
 * - Local: JSON file under ./data
 * - Vercel: Upstash Redis (required)
 *
 * Also stores append-only audit events per session (not LLM context).
 */

let redis;

const EVENT_TTL_SEC = 60 * 60 * 24 * 7;
const EVENT_CAP = 400;
const INDEX_KEY = "session:index";
const INDEX_CAP = 100;

function getRedis() {
  if (redis) return redis;
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

const FILE = path.join(process.cwd(), "data", "store.json");

function readFileStore() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    data.sessions = data.sessions || {};
    data.events = data.events || {};
    data.index = data.index || [];
    return data;
  } catch {
    return { sessions: {}, events: {}, index: [] };
  }
}

function writeFileStore(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function assertStoreReady() {
  if (process.env.VERCEL && !getRedis()) {
    throw new Error(
      "On Vercel set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Serverless cannot keep file/memory state."
    );
  }
}

export async function getSession(id) {
  const r = getRedis();
  if (r) {
    return (await r.get(`session:${id}`)) || null;
  }
  return readFileStore().sessions[id] ?? null;
}

export async function saveSession(session) {
  assertStoreReady();
  session.updatedAt = Date.now();
  const r = getRedis();
  if (r) {
    await r.set(`session:${session.id}`, session, { ex: EVENT_TTL_SEC });
    return session;
  }
  const data = readFileStore();
  data.sessions[session.id] = session;
  writeFileStore(data);
  return session;
}

export async function appendSessionEvent(sessionId, event) {
  assertStoreReady();
  const r = getRedis();
  if (r) {
    const key = `session:${sessionId}:events`;
    await r.rpush(key, event);
    await r.ltrim(key, -EVENT_CAP, -1);
    await r.expire(key, EVENT_TTL_SEC);
    return event;
  }
  const data = readFileStore();
  const list = data.events[sessionId] || [];
  list.push(event);
  data.events[sessionId] = list.slice(-EVENT_CAP);
  writeFileStore(data);
  return event;
}

export async function listSessionEvents(sessionId) {
  const r = getRedis();
  if (r) {
    const rows = await r.lrange(`session:${sessionId}:events`, 0, -1);
    return Array.isArray(rows) ? rows : [];
  }
  return readFileStore().events[sessionId] || [];
}

export async function upsertSessionIndex(session) {
  if (!session?.id) return;
  const row = {
    id: session.id,
    name: session.name || null,
    age: session.age ?? null,
    phase: session.phase,
    dueAt: session.dueAt || null,
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || Date.now(),
    llmCalls: session.metrics?.llmCalls ?? 0,
    latenessMs: session.metrics?.latenessMs ?? null,
  };
  const r = getRedis();
  if (r) {
    let index = (await r.get(INDEX_KEY)) || [];
    if (!Array.isArray(index)) index = [];
    index = index.filter((x) => x && x.id !== session.id);
    index.unshift(row);
    index = index.slice(0, INDEX_CAP);
    await r.set(INDEX_KEY, index, { ex: EVENT_TTL_SEC });
    return;
  }
  const data = readFileStore();
  data.index = (data.index || []).filter((x) => x && x.id !== session.id);
  data.index.unshift(row);
  data.index = data.index.slice(0, INDEX_CAP);
  writeFileStore(data);
}

export async function listSessionIndex(limit = 50) {
  const n = Math.max(1, Math.min(100, Number(limit) || 50));
  const r = getRedis();
  if (r) {
    const index = (await r.get(INDEX_KEY)) || [];
    return (Array.isArray(index) ? index : []).slice(0, n);
  }
  return (readFileStore().index || []).slice(0, n);
}

export function emptyMetrics() {
  return {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    plannedDueAt: null,
    deliveredAt: null,
    latenessMs: null,
  };
}

export function bumpMetrics(session, usage) {
  session.metrics = session.metrics || emptyMetrics();
  session.metrics.llmCalls += 1;
  session.metrics.inputTokens += usage?.prompt_tokens ?? 0;
  session.metrics.outputTokens += usage?.completion_tokens ?? 0;
}
