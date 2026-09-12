/**
 * Deterministic validators. Model proposes; runtime decides.
 * We validate shape — we do not prove legal identity.
 */

export function normalizeNameCandidate(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^(i am|i'm|im|my name is|this is|it's|its)\s+/i, "");
  // Only strip a single trailing sentence punct — not the whole token ("..").
  s = s.replace(/[?!,…]+$/g, "").trim();
  if (/[a-z\u00c0-\u024f]/i.test(s)) {
    s = s.replace(/\.+$/g, "").trim();
  }
  return s;
}

const CONTROL = /[\u0000-\u001F\u007F]/;

/** Words / phrases that look like names but are refusals, jokes, or fillers. */
const NON_NAMES = new Set([
  "ok",
  "okay",
  "why",
  "yes",
  "no",
  "hi",
  "hello",
  "hey",
  "yo",
  "h",
  "sup",
  "yea",
  "yeah",
  "yep",
  "good",
  "thanks",
  "thank you",
  "nothing",
  "nobody",
  "noone",
  "no one",
  "none",
  "null",
  "undefined",
  "n/a",
  "na",
  "idk",
  "dunno",
  "someone",
  "anyone",
  "everyone",
  "me",
  "myself",
  "you",
  "your name",
  "anonymous",
  "anon",
  "test",
  "asdf",
  "foo",
  "bar",
  "baz",
  "dickhead",
  "asshole",
  "bastard",
  "idiot",
]);

/** Function words / sentence glue — not personal-name tokens. */
const NAME_STOP = new Set([
  "how",
  "are",
  "you",
  "your",
  "what",
  "whats",
  "when",
  "where",
  "why",
  "who",
  "is",
  "am",
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "do",
  "did",
  "does",
  "can",
  "could",
  "would",
  "should",
  "will",
  "just",
  "like",
  "have",
  "has",
  "had",
  "not",
  "dont",
  "don't",
  "need",
  "want",
  "please",
  "tell",
  "call",
  "my",
  "name",
  "time",
  "age",
]);

export function validateName(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, reason: "empty" };
  if (name.length < 2) return { ok: false, reason: "too_short" };
  if (name.length > 40) return { ok: false, reason: "length" };
  if (CONTROL.test(name)) return { ok: false, reason: "control_chars" };
  if (!/[\p{L}]/u.test(name)) return { ok: false, reason: "no_letter" };
  if (!/^[\p{L}\p{M}'’.\- ]+$/u.test(name)) {
    return { ok: false, reason: "invalid_chars" };
  }
  if (/\d/.test(name) || /https?:\/\//i.test(name) || /@/.test(name)) {
    return { ok: false, reason: "not_a_name" };
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 3) return { ok: false, reason: "too_many_words" };
  const lower = name.toLowerCase();
  if (NON_NAMES.has(lower)) {
    return { ok: false, reason: "not_a_name" };
  }
  if (words.some((w) => NAME_STOP.has(w.toLowerCase()))) {
    return { ok: false, reason: "looks_like_sentence" };
  }
  if (/^[.'’\- ]+$/.test(name)) {
    return { ok: false, reason: "not_a_name" };
  }
  // Questions / chat lines are not names
  if (/\?$/.test(name) || /^(how|what|why|where|who)\b/i.test(name)) {
    return { ok: false, reason: "looks_like_sentence" };
  }
  const value = name.replace(/\p{L}+/gu, (w) => {
    const chars = [...w];
    return chars[0].toLocaleUpperCase() + chars.slice(1).join("").toLocaleLowerCase();
  });
  return { ok: true, value };
}

/** Integer age; product policy range 0–130. Never silent parseInt("27abc"). */
export function validateAge(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, reason: "empty" };
  }
  const s = String(raw).trim();
  if (!/^\d{1,3}$/.test(s)) return { ok: false, reason: "not_integer" };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 130) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, value: n };
}

/**
 * Pull a clear age offer from free text when the model misses it.
 * "2+2", jokes, and bare math stay rejected by validateAge / patterns.
 */
export function extractAgeFromText(text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, reason: "empty" };
  const patterns = [
    /\b(?:i(?:'?m| am)\s+)(\d{1,3})\b/i,
    /\b(?:i(?:'?m| am)\s+)?(\d{1,3})\s*(?:years?\s*old|yrs?\s*old)\b/i,
    /\b(?:age(?:\s+is)?|yaşım(?:\s+da)?)\s*[:=]?\s*(\d{1,3})\b/i,
    /^(\d{1,3})[.!?]*$/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const check = validateAge(m[1]);
    if (check.ok) return check;
  }
  return { ok: false, reason: "no_age" };
}

const INVALID_DURATION = new Set([
  "later",
  "soon",
  "awhile",
  "a while",
  "sometime",
  "some time",
  "whenever",
  "asap",
  "now",
  "quick",
  "bit",
  "a bit",
]);

/**
 * Parse user-chosen wait duration. Examples: "3 minutes", "5 min", "1 hour".
 * Returns milliseconds. Rejects vague words like "later"/"soon".
 */
export function extractDurationFromText(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return { ok: false, reason: "empty" };

  const half = t.match(/\bhalf\s*(an?\s*)?hour\b/);
  if (half) {
    return { ok: true, valueMs: 30 * 60 * 1000, label: "30 minutes", seconds: 1800 };
  }

  const m = t.match(
    /\b(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i
  );
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "invalid_number" };

    const unit = m[2].toLowerCase();
    let seconds;
    if (/^h|hour|hr/.test(unit)) seconds = n * 3600;
    else if (/^m|min/.test(unit)) seconds = n * 60;
    else seconds = n;

    seconds = Math.round(seconds);
    const minSec = Number(process.env.MIN_DELAY_SECONDS || 5);
    const maxSec = Number(process.env.MAX_DELAY_SECONDS || 24 * 3600);
    if (seconds < minSec) return { ok: false, reason: "too_short", seconds };
    if (seconds > maxSec) return { ok: false, reason: "too_long", seconds };

    const label = formatDurationLabel(seconds);
    return { ok: true, valueMs: seconds * 1000, label, seconds };
  }

  if (
    INVALID_DURATION.has(t) ||
    /^(in a )?(bit|while|moment|sec|second)$/i.test(t) ||
    /^(later|soon|whenever|asap)\b/i.test(t)
  ) {
    return { ok: false, reason: "vague" };
  }

  return { ok: false, reason: "no_duration" };
}

export function formatDurationLabel(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s % 3600 === 0) {
    const h = s / 3600;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  if (s % 60 === 0) {
    const m = s / 60;
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  return s === 1 ? "1 second" : `${s} seconds`;
}

/**
 * Pull name + optional duration from one message.
 * e.g. "My name is John and I need 3 minutes"
 */
export function extractOffersFromMessage(text) {
  const raw = String(text || "").trim();
  const duration = extractDurationFromText(raw);

  let name = { ok: false, reason: "no_name" };
  // Prefer explicit offer — never treat a full chat sentence as a bare name.
  const nameMatch = raw.match(
    /(?:my name is|i(?:'?m| am)|call me|this is)\s+([A-Za-z\u00C0-\u024F][\w'’.\-]*)/i
  );
  if (nameMatch) {
    // "my name is not X" is a denial, not an offer
    if (!/^not$/i.test(nameMatch[1])) {
      name = validateName(normalizeNameCandidate(nameMatch[1]));
    }
  } else {
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 1 && !duration.ok) {
      name = validateName(normalizeNameCandidate(raw));
    }
  }

  return { name, duration };
}

/** @deprecated Prefer session.delayMs from user-chosen duration. */
export function delayMs() {
  const sec = Number(process.env.DELAY_SECONDS || 180);
  return Math.max(1, sec) * 1000;
}
