import OpenAI from "openai";

const VOICE = `Short messenger reply. Plain. No filler.`;

function client() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey: key });
}

export function publicModelName() {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

function supportsReasoningEffort(model) {
  return /^(gpt-5)/i.test(model);
}

const ACTIONS_ONBOARD = [
  "ASK_NAME",
  "EXPLAIN_NAME_PURPOSE",
  "GREET",
  "ANSWER",
  "ACK",
  "DECLINE_NAME",
  "OTHER",
];

const ACTIONS_CHAT = ["ANSWER", "ACK", "OTHER"];

/** Onboarding only — name collection fields exist here. */
const onboardSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyNow: { type: "string" },
    action: { type: "string", enum: ACTIONS_ONBOARD },
    offeringName: { type: "boolean" },
    nameCandidate: { type: "string" },
    deferredAgeQuestion: { type: "string" },
  },
  required: [
    "replyNow",
    "action",
    "offeringName",
    "nameCandidate",
    "deferredAgeQuestion",
  ],
};

/**
 * Chat/age schemas must NOT include name fields.
 * Forcing nameCandidate in CHATTING caused "I am …" → fake name / name re-ask.
 */
const chatSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyNow: { type: "string" },
    action: { type: "string", enum: ACTIONS_CHAT },
    engagement: { type: "string", enum: ["normal", "quiet"] },
  },
  required: ["replyNow", "action", "engagement"],
};

const ageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyNow: { type: "string" },
    action: { type: "string", enum: ["ANSWER", "ACK", "ASK_AGE", "DECLINE_AGE", "OTHER"] },
    offeringAge: { type: "boolean" },
    ageCandidate: { type: "number" },
  },
  required: ["replyNow", "action", "offeringAge", "ageCandidate"],
};

async function complete({ schemaName, schema, system, user }) {
  const model = publicModelName();
  const openai = client();
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
    max_completion_tokens: 180,
  };
  if (supportsReasoningEffort(model)) body.reasoning_effort = "none";
  else body.temperature = 0.4;

  const response = await openai.chat.completions.create(body);
  const content = response.choices[0]?.message?.content;
  if (!content) {
    const err = new Error("empty_model_content");
    err.source = "provider_error";
    throw err;
  }
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    const err = new Error("parse_error");
    err.source = "parse_error";
    err.raw = content;
    throw err;
  }
  return { data, usage: response.usage, model: response.model, source: "llm" };
}

export async function bootTurn() {
  return complete({
    schemaName: "boot_turn",
    schema: onboardSchema,
    system: VOICE,
    user: `Ask their name in one short line.
JSON: offeringName=false, nameCandidate="", deferredAgeQuestion="", action=ASK_NAME.`,
  });
}

export async function nameTurn(userText, { nameNudges = 0 } = {}) {
  const pushback = isNameAskPushback(userText);
  return complete({
    schemaName: "name_turn",
    schema: onboardSchema,
    system: VOICE,
    user: `Name gate — goal is still a real personal name. nameNudgesSoFar=${nameNudges}.
Rules:
- offeringName=true ONLY for a real personal name (2+ letters). Never "..", "h", "yo", "nothing", punctuation, jokes.
- If offeringName: nameCandidate=name only; deferredAgeQuestion=one natural line for LATER like "Hey {name} — how old are you?"; replyNow=warm greet, no age.
- Answer their message in one short line, then keep the name goal alive unless pushback=${pushback}.
- Vary the invite (not the same "What's your name?" every turn). Soft is fine: "What should I call you?" / "Got a name I can use?"
- If pushback: acknowledge only — no name ask this turn.
- Single letters / "yo"/"hey" are NOT names.

User:
"""${userText}"""`,
  });
}

export async function chatTurn({
  name,
  quiet,
  userText,
  openThread = null,
  clock = null,
}) {
  const clockLine = clock
    ? `App clock (trust this): ${clock.date}, ${clock.time} ${clock.timeZone}.`
    : "";
  const threadLine = openThread
    ? `Open thread (unresolved user ask): """${openThread}""" — if they say "it/that/where is it", answer that thread.`
    : "Open thread: none.";
  return complete({
    schemaName: "chat_turn",
    schema: chatSchema,
    system: VOICE,
    user: `Their name is ${name} (session truth — do not change it; do not "correct" it to a similar spelling).
You are the timed-agent demo assistant. No personal name. No fake safety story about hiding your name.
${clockLine}
${threadLine}
engagement=quiet if they don't want to talk / say nothing much; else normal.
If quiet preference already on (${quiet ? "yes" : "no"}): no topic bait; still answer a real question/statement.
Answer with something useful when they ask a real question — not only "Sounds fun!".
Do not end every reply with a question.
Do not say "what's on your mind".
Do not invent wall-clock time; use the app clock line if they ask.

User:
"""${userText}"""`,
  });
}

export async function ageTurn({ name, userText, ageNudges = 0 }) {
  const pushback = isAgeAskPushback(userText);
  return complete({
    schemaName: "age_turn",
    schema: ageSchema,
    system: VOICE,
    user: `Age gate for ${name}. Age already asked once via deferred follow-up. ageNudgesSoFar=${ageNudges}.
Rules:
- offeringAge=true ONLY for a clear personal age number (integer years). Not math puzzles, not jokes.
- If offeringAge: ageCandidate=that number; replyNow=short warm ack (no more age ask). Example: "Nice — thanks, ${name}."
- Answer their actual message in one short line. Do NOT end every reply with an age question.
- If they ask why: one brief reason. Soft re-invite only if ageNudgesSoFar < 2.
- If pushback=${pushback}: acknowledge, do NOT ask age this turn.
- If ageNudgesSoFar >= 2: never ask age this turn — wait for them.
- Never ask their name. Never invent an age.

User:
"""${userText}"""`,
  });
}

export function defaultDeferredAgeQuestion(name) {
  const n = String(name || "").trim() || "there";
  return `Hey ${n} — how old are you?`;
}

export async function repairDeferredAgeQuestion(name) {
  const out = await complete({
    schemaName: "deferred_age",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { deferredAgeQuestion: { type: "string" } },
      required: ["deferredAgeQuestion"],
    },
    system: VOICE,
    user: `Write ONE casual deferred age question for ${name}.
Must include their name. Soft interruption vibe, not a form.
Good: "Hey ${name} — how old are you?"
Bad: "Please enter your age." / "What is your date of birth?"`,
  });
  const q = String(out.data.deferredAgeQuestion || "").trim();
  return {
    question: polishDeferredAgeAsk(q, name),
    usage: out.usage,
    source: out.source,
  };
}

/** Ensure deferred age ask sounds human and names them. */
export function polishDeferredAgeAsk(raw, name) {
  const n = String(name || "").trim();
  let s = String(raw || "").trim();
  if (!s || s.length < 6 || !/\b(age|old|ya[sş]|kaç)\b/i.test(s)) {
    return defaultDeferredAgeQuestion(n);
  }
  s = s.replace(/\s+/g, " ").replace(/^["']|["']$/g, "");
  if (n && !new RegExp(`\\b${escapeReg(n)}\\b`, "i").test(s)) {
    s = s.replace(/^by the way,?\s*/i, "");
    s = `${n} — ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  }
  return s;
}

export function stripAgeAsk(text) {
  const s = String(text || "").trim();
  if (!/\b(age|old|ya[sş]|kaç yaş)\b/i.test(s)) return s;
  return s
    .replace(
      /[^.!?]*\b(how old|what(?:'s| is) your age|yaşın(?:ız)? (?:kaç|ne)|kaç yaş|by the way[, ]+how old)[^.!?]*[.!?]*/gi,
      ""
    )
    .trim();
}

export function stripAgeQuestion(text) {
  return String(text || "")
    .trim()
    .replace(
      /[^.!?]*\b(how old (?:are|r) you|what(?:'s| is) your age|yaşın(?:ız)? (?:kaç|ne)|kaç yaşındasın)[^.!?]*[.!?]*/gi,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isAgeAskPushback(text) {
  const t = String(text || "").trim().toLowerCase();
  return /(already asked|keep asking|stop asking|why (do )?you (keep )?ask|none of your|dont want to (say|tell)|don't want to (say|tell)|not telling)/i.test(
    t
  );
}

export function ensureAgeInvite(replyNow, action, opts = {}) {
  const {
    accepted = false,
    rejected = false,
    ageNudges = 0,
    userText = "",
    name = "",
  } = opts;

  let text = String(replyNow || "").trim();

  if (accepted) {
    text = stripAgeQuestion(text);
    if (
      !text ||
      text.length < 8 ||
      /^(cool|ok|okay|got it|sure|alright|nice|thanks)\.?$/i.test(text)
    ) {
      text = name ? `Nice — thanks, ${name}.` : "Nice — thanks.";
    }
    return text;
  }

  if (rejected) {
    text = stripAgeQuestion(text);
    if (/^(got it|okay|ok|cool|sure|alright|nice)\b/i.test(text) || !text) {
      text =
        ageNudges >= 2
          ? "Need a real age when you're ready — just the number."
          : "Need a real age number when you're ready.";
    }
    if (ageNudges < 2 && !/\b(age|old|ya[sş])\b/i.test(text)) {
      text = `${text} How old are you?`.trim();
    }
    return text;
  }

  const pushback = isAgeAskPushback(userText);
  const tooMany = ageNudges >= 2;

  if (pushback || tooMany) {
    text = stripAgeQuestion(text);
    if (!text) {
      text = pushback
        ? "All good — whenever you want."
        : "Still here.";
    }
    return text;
  }

  if (/\b(age|old|ya[sş]|kaç)\b/i.test(text)) return text;
  if (action === "DECLINE_AGE") return text;
  if (ageNudges < 2 && (action === "ACK" || action === "ANSWER" || !text)) {
    if (!text || /^(got it|okay|ok|cool|sure|alright)\.?$/i.test(text)) {
      return text
        ? `${text} How old are you?`
        : "How old are you?";
    }
  }
  return text || "…";
}

export function stripNameAsk(text, knownName) {
  let s = String(text || "").trim();
  if (!knownName) return s;
  if (
    /\b(your name|tell me your name|what.*call you|who are you again)\b/i.test(s)
  ) {
    return `I know — you're ${knownName}.`;
  }
  return s;
}

/** Drop trailing / embedded name-collection questions during NEED_NAME anti-spam. */
export function stripNameQuestion(text) {
  return String(text || "")
    .trim()
    .replace(
      /[^.!?]*\b(what(?:'s| is) your name|tell me your name|what should i call you|could you (?:please )?tell me your name|your name\??)\b[^.!?]*[.!?]*/gi,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isNameAskPushback(text) {
  const t = String(text || "").trim().toLowerCase();
  return /(already asked|keep asking|why (do )?you (keep )?ask|stop asking|you asked this|asked this already|why ask(ing)?)/i.test(
    t
  );
}

export function looksLikeFalseNameAccept(replyNow, candidate) {
  const r = String(replyNow || "");
  const c = String(candidate || "").trim();
  if (/^hi\b/i.test(r)) return true;
  if (/\b(nice to meet|great to meet|welcome)\b/i.test(r)) return true;
  if (c && new RegExp(`\\b${escapeReg(c)}\\b`, "i").test(r) && /!/.test(r)) {
    return true;
  }
  return false;
}

/** Shown text after validateName fails — layer: paint, not model. */
export function rejectNamePaint(modelReply, candidate) {
  if (looksLikeFalseNameAccept(modelReply, candidate) || !String(modelReply || "").trim()) {
    return "That doesn't look like a name. What should I call you?";
  }
  // Even non-greet model text can imply accept; keep soft reject fixed.
  return "That doesn't look like a name. What should I call you?";
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripTopicPush(text) {
  return String(text || "")
    .trim()
    .replace(
      /[^.!?]*\b(what('?s| is) on your mind|what do you (want to|wanna) talk about|how can i help you today|what should we talk about)[^.!?]*[.!?]*/gi,
      ""
    )
    .trim();
}

/**
 * NEED_NAME paint: stay on the name goal until validated.
 * Anti-spam = vary wording + one-turn pause on pushback — never abandon.
 */
export function ensureNameInvite(phase, replyNow, action, opts = {}) {
  if (phase !== "NEED_NAME") return replyNow;
  const {
    rejected = false,
    candidate = "",
    nameNudges = 0,
    userText = "",
  } = opts;

  let text = String(replyNow || "").trim();

  if (rejected) {
    return rejectNamePaint(text, candidate);
  }

  const pushback = isNameAskPushback(userText);
  if (pushback) {
    text = stripNameQuestion(text);
    return text || "Fair — say it whenever you're ready.";
  }

  // Already inviting — keep model's wording if present.
  if (/\b(name|call you|call me)\b/i.test(text)) return text;
  if (action === "DECLINE_NAME") return text;

  const invite = softNameInvite(nameNudges);
  if (!text || /^(got it|okay|ok|cool|sure|alright|hi|hey|yo)\.?$/i.test(text)) {
    return text ? `${text} ${invite}` : invite;
  }
  // Any other reply while still NEED_NAME: append soft invite.
  return `${text} ${invite}`;
}

export function softNameInvite(nameNudges = 0) {
  const n = Number(nameNudges) || 0;
  if (n <= 1) return "What should I call you?";
  if (n <= 3) return "Got a name I can use?";
  if (n <= 5) return "Just a first name works.";
  return "Whenever you're ready — your name?";
}

/** Low-signal only — does NOT swallow real statements like "i am tired". */
export function isLowSignal(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(nothing|nada|idk|n\/a|nope|nah|no|not much|nm)[\s?.!]*$/i.test(t);
}

export function isHardQuiet(text) {
  const t = String(text || "").trim().toLowerCase();
  return /don'?t want to talk|do not want to talk|dont want to talk|leave me alone|stop talking|shut up|go away/.test(
    t
  );
}

export function kindFromAction(action, fallback) {
  const map = {
    ASK_NAME: "ask_name",
    EXPLAIN_NAME_PURPOSE: "explain",
    GREET: "greet",
    ACK: "ack",
    ASK_AGE: "ask_age",
    DECLINE_NAME: "decline",
    DECLINE_AGE: "decline",
    ANSWER: "answer",
  };
  return map[action] || fallback || "chat";
}
