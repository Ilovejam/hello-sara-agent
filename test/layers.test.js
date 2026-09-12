import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rejectNamePaint, ensureNameInvite } from "../lib/openai.js";
import {
  parseNameUpdate,
  classifyFactAsk,
  answerFactAsk,
  updateOpenThread,
  namesLooselyEqual,
  formatAppClock,
} from "../lib/dialogue.js";
import { validateName, normalizeNameCandidate, extractDurationFromText, extractOffersFromMessage } from "../lib/validate.js";

/**
 * Multi-turn regression from the Jony transcript.
 * These assert RUNTIME layers — not invented "model would say X".
 */

describe("Layer — NEED_NAME reject paint (my name is ..)", () => {
  it("validate rejects .. ; paint never shows Hi ..!", () => {
    const candidate = normalizeNameCandidate("my name is ..");
    assert.equal(candidate, "..");
    assert.equal(validateName(candidate).ok, false);

    // Model layer (simulated provider output) vs paint layer
    const providerReply = "Hi ..!";
    const painted = rejectNamePaint(providerReply, candidate);
    assert.notEqual(painted, providerReply);
    assert.doesNotMatch(painted, /^Hi\b/i);
    assert.match(painted, /doesn't look like a name/i);

    const viaEnsure = ensureNameInvite("NEED_NAME", providerReply, "GREET", {
      rejected: true,
      candidate,
    });
    assert.equal(viaEnsure, painted);
  });
});

describe("Layer — CHATTING name mutation (Jack → not johny)", () => {
  it("set Jack updates; not johny does NOT flip session to Jony", () => {
    assert.equal(parseNameUpdate("no my name is jack", "Jony").type, "set");
    assert.equal(parseNameUpdate("no my name is jack", "Jony").value, "Jack");

    // After set, session.name would be Jack
    const neg = parseNameUpdate("not johny", "Jack");
    assert.equal(neg.type, "reject_other");
    assert.notEqual(neg.type, "set");
    // handleChatting keeps session.name === Jack and does not call LLM

    assert.equal(namesLooselyEqual("Jony", "johny"), true);
    const negCurrent = parseNameUpdate("not johny", "Jony");
    assert.equal(negCurrent.type, "reject_current");
    // Must NOT yield value:"Jony" as a set
    assert.equal(negCurrent.value, undefined);
  });
});

describe("Layer — facts (identity + clock)", () => {
  it("identity and time bypass LLM", () => {
    assert.equal(classifyFactAsk("what is your name?"), "assistant_identity");
    assert.equal(classifyFactAsk("who built you"), "assistant_identity");
    assert.equal(classifyFactAsk("what time is it now?"), "time");

    const id = answerFactAsk("assistant_identity");
    assert.match(id.content, /timed-agent|demo/i);
    assert.doesNotMatch(id.content, /safety|don't share|do not share/i);

    const fixed = new Date("2026-09-12T00:42:00+03:00");
    const t = answerFactAsk("time", fixed);
    assert.match(t.content, /00:42/);
    const clock = formatAppClock(fixed, "Europe/Istanbul");
    assert.equal(clock.time, "00:42");
  });
});

describe("Layer — open thread (where is it)", () => {
  it("keeps party ask across pronoun follow-up", () => {
    const t1 = updateOpenThread(null, "where is the best party happening");
    assert.match(t1, /party/i);
    const t2 = updateOpenThread(t1, "i like crazy party");
    assert.match(t2, /crazy party/i);
    const t3 = updateOpenThread(t2, "tell me where is it");
    assert.equal(t3, t2);
  });
});

describe("Layer — Assignment PDF duration step", () => {
  it("3 minutes / 1 hour ok; later rejected; combo extracts both", () => {
    const m3 = extractDurationFromText("3 minutes");
    assert.equal(m3.ok, true);
    assert.equal(m3.seconds, 180);
    const h1 = extractDurationFromText("1 hour");
    assert.equal(h1.ok, true);
    assert.equal(h1.seconds, 3600);
    assert.equal(extractDurationFromText("later").ok, false);
    assert.equal(extractDurationFromText("soon").reason, "vague");

    const combo = extractOffersFromMessage(
      "My name is John and I need 3 minutes"
    );
    assert.equal(combo.name.ok, true);
    assert.equal(combo.name.value, "John");
    assert.equal(combo.duration.ok, true);
    assert.equal(combo.duration.seconds, 180);
  });

  it("rejects chat sentences as names; 100 min ok", () => {
    assert.equal(validateName("how are you you dickhead").ok, false);
    assert.equal(
      extractOffersFromMessage("how are you you dickhead").name.ok,
      false
    );
    const m100 = extractDurationFromText("100 min");
    assert.equal(m100.ok, true);
    assert.equal(m100.seconds, 6000);
  });
});
