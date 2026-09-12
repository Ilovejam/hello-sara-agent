import { randomUUID } from "node:crypto";
import {
  bumpMetrics,
  emptyMetrics,
  getSession,
  saveSession,
} from "./store.js";
import {
  extractAgeFromText,
  extractDurationFromText,
  extractOffersFromMessage,
  normalizeNameCandidate,
  validateAge,
  validateName,
} from "./validate.js";
import { classifyChatIngress } from "./chatRoute.js";
import * as llm from "./openai.js";
import {
  answerFactAsk,
  classifyFactAsk,
  formatAppClock,
  parseNameUpdate,
  updateOpenThread,
} from "./dialogue.js";
import { audit, auditTurn } from "./audit.js";

export async function createSession() {
  const opened = await llm.bootTurn();
  const session = {
    id: randomUUID(),
    phase: "NEED_NAME",
    name: null,
    age: null,
    acceptedAt: null,
    dueAt: null,
    pendingAction: null,
    lastAction: opened.data.action || "ASK_NAME",
    engagement: "normal", // dialogue state — not a transcript
    nameNudges: 1, // boot already asked once
    timeNudges: 0,
    delayMs: null,
    delayLabel: null,
    openThread: null, // last unresolved ask — not a transcript
    version: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metrics: emptyMetrics(),
  };
  bumpMetrics(session, opened.usage);
  await saveSession(session);
  await audit(session, "session.created", {
    bootReply: opened.data.replyNow,
    model: llm.publicModelName(),
  });
  return {
    sessionId: session.id,
    phase: session.phase,
    messages: [
      {
        role: "assistant",
        content: opened.data.replyNow,
        kind: llm.kindFromAction(opened.data.action, "open"),
        source: opened.source,
      },
    ],
    metrics: session.metrics,
    model: llm.publicModelName(),
    note: "Wait duration is user-chosen in NEED_TIME (not a fixed 180s).",
  };
}

function paintOnboard(session, data, opts = {}) {
  let raw = llm.stripAgeAsk(data.replyNow) || data.replyNow || "…";
  raw = llm.stripTopicPush(raw);
  raw = llm.ensureNameInvite(session.phase, raw, data.action, {
    rejected: !!opts.rejected,
    candidate: data.nameCandidate || "",
    nameNudges: session.nameNudges || 0,
    userText: opts.userText || "",
  });
  return raw || "…";
}

function countNameNudge(session, painted) {
  if (/\b(name|call you)\b/i.test(painted)) {
    session.nameNudges = (session.nameNudges || 0) + 1;
  }
}

function paintAge(session, data, opts = {}) {
  let raw = llm.stripNameAsk(data.replyNow || "", session.name);
  raw = llm.stripTopicPush(raw);
  raw = llm.ensureAgeInvite(raw, data.action, {
    accepted: !!opts.accepted,
    rejected: !!opts.rejected,
    ageNudges: session.ageNudges || 0,
    userText: opts.userText || "",
    name: session.name || "",
  });
  return raw || "…";
}

function countAgeNudge(session, painted) {
  if (/\b(age|old|ya[sş]|kaç)\b/i.test(painted)) {
    session.ageNudges = (session.ageNudges || 0) + 1;
  }
}

/** Arm CHATTING wait from a validated duration. 0 LLM on fire later. */
async function armWaitFromDuration(session, duration, opts = {}) {
  const deferred =
    opts.deferred ||
    llm.polishDeferredAgeAsk("", session.name) ||
    llm.defaultDeferredAgeQuestion(session.name);

  const armedAt = Date.now();
  session.phase = "CHATTING";
  session.delayMs = duration.valueMs;
  session.delayLabel = duration.label;
  session.durationAcceptedAt = armedAt;
  session.dueAt = armedAt + duration.valueMs;
  session.version += 1;
  session.lastAction = "ACK";
  session.engagement = "normal";
  session.pendingAction = {
    id: randomUUID(),
    intent: "collect_age",
    modelMessage: deferred,
    status: "pending",
    createdAt: armedAt,
  };
  session.metrics.plannedDueAt = session.dueAt;
  await saveSession(session);
  try {
    await audit(session, "time.accepted", {
      delayMs: duration.valueMs,
      delayLabel: duration.label,
      seconds: duration.seconds,
    });
    await audit(session, "timer.armed", {
      dueAt: session.dueAt,
      delayMs: duration.valueMs,
      delayLabel: duration.label,
    });
  } catch {
    /* audit must never block arming */
  }

  const greet =
    opts.greet ||
    `Got it, ${session.name}. I'll ask your age in ${duration.label}.`;

  return {
    phase: session.phase,
    name: session.name,
    dueAt: session.dueAt,
    delayMs: session.delayMs,
    delayLabel: session.delayLabel,
    route: opts.route || "→arm_wait",
    messages: [
      {
        role: "assistant",
        content: greet,
        kind: "time_accepted",
        source: opts.source || "validation",
      },
      {
        role: "system",
        content: `Follow-up scheduled · ${duration.label}`,
        kind: "system",
        source: "validation",
      },
    ],
    metrics: session.metrics,
  };
}

function paintChat(session, data) {
  let raw = llm.stripAgeAsk(data.replyNow) || data.replyNow || "…";
  raw = llm.stripNameAsk(raw, session.name);
  if (session.engagement === "quiet") raw = llm.stripTopicPush(raw);
  raw = llm.stripTopicPush(raw);
  if (!raw) raw = session.engagement === "quiet" ? "Alright." : "…";
  return raw;
}

/**
 * CHATTING must never re-enter name validation.
 * Quiet = dialogue preference; does not cancel dueAt age follow-up.
 */
export async function handleMessage(sessionId, text) {
  const session = await getSession(sessionId);
  if (!session) {
    const err = new Error("not_found");
    err.status = 404;
    throw err;
  }

  await audit(session, "user.message", {
    text,
    phaseBefore: session.phase,
  });

  try {
    let out;
    if (session.phase === "NEED_NAME") {
      out = await handleNeedName(session, text);
    } else if (session.phase === "NEED_TIME") {
      out = await handleNeedTime(session, text);
    } else if (session.phase === "CHATTING") {
      out = await handleChatting(session, text);
    } else if (session.phase === "NEED_AGE") {
      out = await handleNeedAge(session, text);
    } else {
      out = {
        phase: session.phase,
        route: "DONE→idle",
        messages: [
          {
            role: "assistant",
            content: "All set.",
            kind: "done",
            source: "validation",
          },
        ],
        metrics: session.metrics,
      };
    }
    await auditTurn(sessionId, text, out);
    return out;
  } catch (err) {
    // Never wipe name / phase / timer on LLM failure.
    err.status = err.status || 502;
    try {
      await audit(session, "error", {
        message: String(err.message || err),
        userText: text,
        status: err.status,
      });
    } catch {
      /* ignore audit failure */
    }
    throw err;
  }
}

async function handleNeedName(session, text) {
  // Runtime multi-offer: "My name is John and I need 3 minutes"
  const offers = extractOffersFromMessage(text);
  if (offers.name.ok) {
    session.name = offers.name.value;
    session.acceptedAt = Date.now();
    session.version += 1;
    await audit(session, "name.accepted", {
      name: session.name,
      via: "runtime_extract",
      alsoDuration: offers.duration.ok,
    });

    if (offers.duration.ok) {
      return armWaitFromDuration(session, offers.duration, {
        greet: `Hi ${session.name}! I'll ask your age in ${offers.duration.label}.`,
        route: "NEED_NAME→name+time",
        source: "validation",
      });
    }

    session.phase = "NEED_TIME";
    session.lastAction = "ASK_TIME";
    await saveSession(session);
    return {
      phase: "NEED_TIME",
      name: session.name,
      route: "NEED_NAME→need_time",
      messages: [
        {
          role: "assistant",
          content: `Hi ${session.name}! How much time do you need?`,
          kind: "ask_time",
          source: "validation",
        },
      ],
      metrics: session.metrics,
    };
  }

  const result = await llm.nameTurn(text, {
    nameNudges: session.nameNudges || 0,
  });
  bumpMetrics(session, result.usage);
  const data = { ...result.data };
  session.lastAction = data.action || "OTHER";

  const typed = parseNameUpdate(text, null);
  if (typed?.type === "set") {
    data.offeringName = true;
    data.nameCandidate = typed.value;
  } else if (typed?.type === "invalid_offer") {
    data.offeringName = true;
    data.nameCandidate = String(typed.raw || "");
  }

  // Duration alone while still needing name — acknowledge but stay on name.
  if (!data.offeringName && offers.duration.ok) {
    const painted = paintOnboard(session, data, { userText: text });
    countNameNudge(session, painted);
    await saveSession(session);
    return {
      phase: "NEED_NAME",
      route: "NEED_NAME→time_without_name",
      messages: [
        {
          role: "assistant",
          content: `${painted} Still need your name first.`,
          kind: "chat",
          source: result.source,
        },
      ],
      metrics: session.metrics,
    };
  }

  if (data.offeringName) {
    const check = validateName(
      normalizeNameCandidate(String(data.nameCandidate || "").trim())
    );
    if (check.ok) {
      session.name = check.value;
      session.acceptedAt = Date.now();
      session.version += 1;
      await audit(session, "name.accepted", {
        name: check.value,
        providerReply: data.replyNow,
      });

      // Same turn may also carry duration (LLM path + runtime duration).
      if (offers.duration.ok) {
        return armWaitFromDuration(session, offers.duration, {
          greet: `Hi ${check.value}! I'll ask your age in ${offers.duration.label}.`,
          deferred: llm.polishDeferredAgeAsk(
            String(data.deferredAgeQuestion || "").trim(),
            check.value
          ),
          route: "NEED_NAME→name+time_llm",
          source: result.source,
        });
      }

      session.phase = "NEED_TIME";
      session.lastAction = "ASK_TIME";
      await saveSession(session);
      const greet =
        paintOnboard({ ...session, phase: "NEED_NAME" }, data, {
          userText: text,
        }) || `Hi ${check.value}!`;
      return {
        phase: "NEED_TIME",
        name: session.name,
        route: "NEED_NAME→need_time",
        messages: [
          {
            role: "assistant",
            content: /time|minute|hour|long/i.test(greet)
              ? greet
              : `${greet.replace(/\s*what should i call you\??/i, "").trim()} How much time do you need?`.trim(),
            kind: "ask_time",
            source: result.source,
          },
        ],
        metrics: session.metrics,
      };
    }

    const painted = paintOnboard(session, data, {
      rejected: true,
      userText: text,
    });
    countNameNudge(session, painted);
    await saveSession(session);
    await audit(session, "name.rejected", {
      candidate: data.nameCandidate,
      reason: check.reason,
      providerReply: data.replyNow,
      painted,
    });
    return {
      phase: "NEED_NAME",
      route: "NEED_NAME→reject_shape",
      messages: [
        {
          role: "assistant",
          content: painted,
          kind: llm.kindFromAction(data.action, "name_rejected"),
          reason: check.reason,
          source: result.source,
        },
      ],
      metrics: session.metrics,
    };
  }

  const painted = paintOnboard(session, data, { userText: text });
  countNameNudge(session, painted);
  await saveSession(session);
  return {
    phase: "NEED_NAME",
    route: "NEED_NAME→chat",
    messages: [
      {
        role: "assistant",
        content: painted,
        kind: llm.kindFromAction(data.action, "chat"),
        source: result.source,
      },
    ],
    metrics: session.metrics,
  };
}

/** Step 2 — user-chosen wait. Prefer runtime parse (0 LLM when clear). */
async function handleNeedTime(session, text) {
  // User denying / correcting the captured name → back to NEED_NAME
  if (
    /\bmy name is not\b/i.test(text) ||
    /\b(?:that(?:'s| is)? not my name|wrong name|not my name)\b/i.test(text)
  ) {
    const prev = session.name;
    session.phase = "NEED_NAME";
    session.name = null;
    session.acceptedAt = null;
    session.lastAction = "ASK_NAME";
    session.version += 1;
    await saveSession(session);
    await audit(session, "name.cleared", { prev, reason: "user_denied" });
    return {
      phase: "NEED_NAME",
      route: "NEED_TIME→name_denied",
      messages: [
        {
          role: "assistant",
          content: "Got it — what should I call you then?",
          kind: "ask_name",
          source: "validation",
        },
      ],
      metrics: session.metrics,
    };
  }

  const rename = extractOffersFromMessage(text);
  if (rename.name.ok && !rename.duration.ok) {
    session.name = rename.name.value;
    await saveSession(session);
    await audit(session, "name.accepted", {
      name: session.name,
      via: "need_time_correction",
    });
    return {
      phase: "NEED_TIME",
      name: session.name,
      route: "NEED_TIME→rename",
      messages: [
        {
          role: "assistant",
          content: `Got it, ${session.name}. How much time do you need?`,
          kind: "ask_time",
          source: "validation",
        },
      ],
      metrics: session.metrics,
    };
  }

  const dur = extractDurationFromText(text);
  if (dur.ok) {
    return armWaitFromDuration(session, dur, {
      route: "NEED_TIME→arm",
      source: "validation",
    });
  }

  session.timeNudges = (session.timeNudges || 0) + 1;
  session.lastAction = "ASK_TIME";
  await saveSession(session);
  await audit(session, "time.rejected", {
    text,
    reason: dur.reason,
  });

  let hint =
    dur.reason === "vague"
      ? `Need a real duration — like "3 minutes" or "1 hour" — not "${String(text).trim()}".`
      : dur.reason === "too_short"
        ? "That's too short for this demo. Try at least a few seconds (or minutes)."
        : dur.reason === "too_long"
          ? "That's too long. Try something under 24 hours (e.g. \"100 minutes\" is fine)."
          : "How much time do you need? Say something like \"3 minutes\" or \"1 hour\".";

  // Common typo: years/yaers as if age — this step wants wait duration
  if (/\b\d+\s*y(?:ea)?rs?\b/i.test(text)) {
    hint =
      "This step is how long to wait (minutes/hours), not your age. Try \"10 minutes\".";
  }

  return {
    phase: "NEED_TIME",
    name: session.name,
    route: "NEED_TIME→reject",
    messages: [
      {
        role: "assistant",
        content: hint,
        kind: "ask_time",
        source: "validation",
      },
    ],
    metrics: session.metrics,
  };
}

async function handleChatting(session, text) {
  const dueAt = session.dueAt;
  const ingress = classifyChatIngress(session.engagement || "normal", text);

  if (ingress === "hard_quiet") {
    session.engagement = "quiet";
    session.lastAction = "ACK";
    await saveSession(session);
    return {
      phase: "CHATTING",
      dueAt,
      route: "CHATTING→hard_quiet",
      messages: [
        {
          role: "assistant",
          content: "Alright.",
          kind: "ack",
          source: "validation",
        },
      ],
      metrics: session.metrics,
    };
  }

  if (ingress === "quiet_hold" || ingress === "soft_quiet") {
    session.engagement = "quiet";
    session.lastAction = "ACK";
    await saveSession(session);
    return {
      phase: "CHATTING",
      dueAt,
      route: `CHATTING→${ingress}`,
      messages: [
        { role: "assistant", content: "Okay.", kind: "ack", source: "validation" },
      ],
      metrics: session.metrics,
    };
  }

  // Runtime name mutation — never let LLM flip Jack ↔ Jony.
  const nameUpdate = parseNameUpdate(text, session.name);
  if (nameUpdate) {
    if (nameUpdate.type === "set") {
      const prev = session.name;
      session.name = nameUpdate.value;
      session.lastAction = "ACK";
      session.openThread = updateOpenThread(session.openThread, text);
      await saveSession(session);
      return {
        phase: "CHATTING",
        dueAt,
        name: session.name,
        route: "CHATTING→name_set",
        messages: [
          {
            role: "assistant",
            content:
              prev && prev !== nameUpdate.value
                ? `Got it — ${nameUpdate.value}.`
                : `Got it, ${nameUpdate.value}.`,
            kind: "name_updated",
            source: "validation",
            debug: { prev, next: nameUpdate.value },
          },
        ],
        metrics: session.metrics,
      };
    }
    if (nameUpdate.type === "invalid_offer") {
      session.lastAction = "ACK";
      await saveSession(session);
      return {
        phase: "CHATTING",
        dueAt,
        name: session.name,
        route: "CHATTING→name_invalid",
        messages: [
          {
            role: "assistant",
            content: `Still using ${session.name}. That didn't look like a name.`,
            kind: "ack",
            source: "validation",
          },
        ],
        metrics: session.metrics,
      };
    }
    if (nameUpdate.type === "reject_current") {
      session.lastAction = "ACK";
      session.openThread = updateOpenThread(session.openThread, text);
      await saveSession(session);
      return {
        phase: "CHATTING",
        dueAt,
        name: session.name,
        route: "CHATTING→name_reject_current",
        messages: [
          {
            role: "assistant",
            content: `Okay — what should I call you instead? (Still have you as ${session.name} until you say.)`,
            kind: "ack",
            source: "validation",
            debug: { kept: session.name, rejected: nameUpdate.rejected },
          },
        ],
        metrics: session.metrics,
      };
    }
    if (nameUpdate.type === "reject_other") {
      session.lastAction = "ACK";
      await saveSession(session);
      return {
        phase: "CHATTING",
        dueAt,
        name: session.name,
        route: "CHATTING→name_reject_other",
        messages: [
          {
            role: "assistant",
            content: `Okay — you're ${session.name}.`,
            kind: "ack",
            source: "validation",
          },
        ],
        metrics: session.metrics,
      };
    }
  }

  // App facts — clock / identity. Layer: dialogue.js, not LLM.
  const factKind = classifyFactAsk(text);
  if (factKind) {
    const fact = answerFactAsk(factKind);
    session.lastAction = "ANSWER";
    session.openThread = updateOpenThread(session.openThread, text);
    await saveSession(session);
    return {
      phase: "CHATTING",
      dueAt,
      name: session.name,
      route: `CHATTING→fact_${factKind}`,
      messages: [
        {
          role: "assistant",
          content: fact.content,
          kind: fact.kind,
          source: "validation",
          debug: fact.clock || null,
        },
      ],
      metrics: session.metrics,
    };
  }

  session.openThread = updateOpenThread(session.openThread, text);
  const clock = formatAppClock();

  const result = await llm.chatTurn({
    name: session.name,
    quiet: session.engagement === "quiet",
    userText: text,
    openThread: session.openThread,
    clock,
  });
  bumpMetrics(session, result.usage);

  if (result.data.engagement === "quiet") session.engagement = "quiet";
  else if (result.data.engagement === "normal") session.engagement = "normal";

  session.lastAction = result.data.action || "ANSWER";
  const painted = paintChat(session, result.data);
  await saveSession(session);

  return {
    phase: "CHATTING",
    dueAt: session.dueAt,
    name: session.name,
    route: "CHATTING→llm",
    engagement: session.engagement,
    messages: [
      {
        role: "assistant",
        content: painted,
        kind: llm.kindFromAction(result.data.action, "chat"),
        source: result.source,
        debug: {
          providerReply: result.data.replyNow,
          painted,
          openThread: session.openThread,
          sessionName: session.name,
        },
      },
    ],
    metrics: session.metrics,
  };
}

async function handleNeedAge(session, text) {
  const result = await llm.ageTurn({
    name: session.name,
    userText: text,
    ageNudges: session.ageNudges || 0,
  });
  bumpMetrics(session, result.usage);
  const data = result.data;
  session.lastAction = data.action || "OTHER";

  let ageCheck = { ok: false };
  if (data.offeringAge && data.ageCandidate != null) {
    ageCheck = validateAge(String(Math.trunc(Number(data.ageCandidate))));
  }
  if (!ageCheck.ok) {
    const extracted = extractAgeFromText(text);
    if (extracted.ok) ageCheck = extracted;
  }

  if (ageCheck.ok) {
    session.phase = "DONE";
    session.age = ageCheck.value;
    session.version += 1;
    const painted = paintAge(session, data, {
      accepted: true,
      userText: text,
    });
    await saveSession(session);
    await audit(session, "age.accepted", {
      age: ageCheck.value,
      providerReply: data.replyNow,
      painted,
    });
    await audit(session, "session.done", {
      name: session.name,
      age: ageCheck.value,
      latenessMs: session.metrics?.latenessMs ?? null,
    });
    return {
      phase: "DONE",
      age: ageCheck.value,
      route: "NEED_AGE→accept",
      messages: [
        {
          role: "assistant",
          content: painted,
          kind: "age_accepted",
          source: result.source,
        },
        {
          role: "system",
          content: `Age saved · ${ageCheck.value}`,
          kind: "system",
          source: "validation",
        },
      ],
      metrics: session.metrics,
    };
  }

  const rejectedOffer = !!data.offeringAge;
  const painted = paintAge(session, data, {
    rejected: rejectedOffer,
    userText: text,
  });
  countAgeNudge(session, painted);
  await saveSession(session);
  return {
    phase: "NEED_AGE",
    route: rejectedOffer ? "NEED_AGE→reject_shape" : "NEED_AGE→chat",
    messages: [
      {
        role: "assistant",
        content: painted,
        kind: llm.kindFromAction(data.action, "chat"),
        source: result.source,
      },
    ],
    metrics: session.metrics,
  };
}

/** Server-owned gate. ZERO LLM. Quiet preference does not cancel this. */
export async function deliverIfDue(sessionId) {
  const session = await getSession(sessionId);
  if (!session) {
    const err = new Error("not_found");
    err.status = 404;
    throw err;
  }

  const pending = session.pendingAction;
  if (!pending || pending.status !== "pending") {
    return {
      delivered: false,
      reason: "nothing_pending",
      phase: session.phase,
      metrics: session.metrics,
    };
  }
  if (session.dueAt == null || Date.now() < session.dueAt) {
    return {
      delivered: false,
      reason: "not_due_yet",
      dueAt: session.dueAt,
      phase: session.phase,
      metrics: session.metrics,
    };
  }

  const deliveredAt = Date.now();
  const ask = llm.polishDeferredAgeAsk(pending.modelMessage, session.name);
  pending.modelMessage = ask;
  pending.status = "delivered";
  pending.deliveredAt = deliveredAt;
  session.phase = "NEED_AGE";
  session.lastAction = "ASK_AGE";
  session.ageNudges = Math.max(1, session.ageNudges || 0);
  session.version += 1;
  session.metrics.deliveredAt = deliveredAt;
  session.metrics.latenessMs = deliveredAt - session.dueAt;
  await saveSession(session);
  await audit(session, "timer.delivered", {
    ask,
    plannedDueAt: session.dueAt,
    deliveredAt,
    latenessMs: session.metrics.latenessMs,
    llmCallsOnFire: 0,
  });

  return {
    delivered: true,
    phase: "NEED_AGE",
    route: "deliver",
    source: "validation",
    messages: [
      {
        role: "system",
        content: "Deferred follow-up · delivered",
        kind: "system",
        source: "validation",
      },
      {
        id: pending.id,
        role: "assistant",
        content: ask,
        kind: "deferred_age_ask",
        plannedDueAt: session.dueAt,
        deliveredAt,
        latenessMs: session.metrics.latenessMs,
      },
    ],
    metrics: session.metrics,
  };
}
