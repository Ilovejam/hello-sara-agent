/**
 * Limited dialogue state helpers — not a transcript.
 * Runtime decides facts / name mutations; model only fills language when needed.
 */

import { normalizeNameCandidate, validateName } from "./validate.js";

export const APP_IDENTITY = {
  assistantName: null, // intentional: no personal name
  role: "I'm the timed-agent demo assistant in this chat.",
  builder: "Built for the Elysee-style deferred-follow-up assignment demo.",
};

export function formatAppClock(now = new Date(), timeZone = process.env.APP_TZ || "Europe/Istanbul") {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, time, timeZone, iso: now.toISOString() };
}

/** Assistant identity / clock — answer from app facts, skip LLM. */
export function classifyFactAsk(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (
    /\b(what(?:'s| is) your name|who are you|who (?:built|made|created|designed) you|who told you)\b/i.test(
      t
    )
  ) {
    return "assistant_identity";
  }
  if (/\b(what time|what(?:'s| is) the time|saat ka[cç])\b/i.test(t)) {
    return "time";
  }
  if (/\b(what(?:'s| is) today|what day is it|bug[uü]n (hangi )?g[uü]n)\b/i.test(t)) {
    return "date";
  }
  return null;
}

export function answerFactAsk(kind, now = new Date()) {
  const clock = formatAppClock(now);
  if (kind === "time") {
    return {
      content: `It's ${clock.time} (${clock.timeZone}).`,
      kind: "fact_time",
      clock,
    };
  }
  if (kind === "date") {
    return {
      content: `Today is ${clock.date} (${clock.timeZone}).`,
      kind: "fact_date",
      clock,
    };
  }
  if (kind === "assistant_identity") {
    return {
      content: `${APP_IDENTITY.role} ${APP_IDENTITY.builder} I don't have a personal name.`,
      kind: "fact_identity",
      clock,
    };
  }
  return null;
}

/**
 * Name mutations in CHATTING — runtime owns session.name.
 * Types: set | reject_current | reject_other | null
 */
export function parseNameUpdate(text, currentName) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const offer = raw.match(
    /^(?:no[, ]+)?(?:my name is|i(?:'?m| am)|call me|it(?:'?s| is))\s+(.+?)\s*$/iu
  );
  if (offer) {
    const check = validateName(normalizeNameCandidate(offer[1]));
    if (check.ok) return { type: "set", value: check.value };
    return { type: "invalid_offer", raw: offer[1] };
  }

  const neg = raw.match(/^(?:no[, ]+)?not\s+(.+?)\s*$/iu);
  if (neg) {
    const rejected = normalizeNameCandidate(neg[1]);
    if (!rejected) return null;
    if (namesLooselyEqual(currentName, rejected)) {
      return { type: "reject_current", rejected };
    }
    return { type: "reject_other", rejected };
  }

  return null;
}

export function namesLooselyEqual(a, b) {
  const x = foldName(a);
  const y = foldName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // johny / jony / johnny
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return false;
}

function foldName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z\u00c0-\u024f]/gi, "")
    .replace(/h/g, ""); // johny ≈ jony
}

/**
 * Keep one open thread string for pronoun follow-ups ("where is it?").
 * Not a chat log — last unresolved ask only.
 */
export function updateOpenThread(prev, userText) {
  const t = String(userText || "").trim();
  if (!t) return prev || null;

  if (
    /^(it|that|this|there)\b/i.test(t) ||
    /\b(where is it|tell me where|what about it|and where)\b/i.test(t)
  ) {
    return prev || null;
  }

  if (
    /\b(where|which|party|best|recommend|place|venue)\b/i.test(t) &&
    t.length >= 8
  ) {
    return t.slice(0, 140);
  }

  if (/^(ok|okay|yeah|yep|thanks|cool|sure|alright|hi|hey)\b/i.test(t)) {
    return prev || null;
  }

  if (t.length >= 12) return t.slice(0, 140);
  return prev || null;
}
