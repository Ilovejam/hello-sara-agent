import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyChatIngress } from "../lib/chatRoute.js";
import {
  isHardQuiet,
  isLowSignal,
  isNameAskPushback,
  stripNameAsk,
  stripNameQuestion,
  stripTopicPush,
  ensureNameInvite,
  polishDeferredAgeAsk,
  ensureAgeInvite,
  defaultDeferredAgeQuestion,
} from "../lib/openai.js";
import {
  normalizeNameCandidate,
  validateName,
  extractAgeFromText,
  validateAge,
} from "../lib/validate.js";

describe("A — Mike transcript hypotheses", () => {
  it("stripNameAsk rewrites name re-ask", () => {
    const out = stripNameAsk(
      "I'm here to help. Can you tell me your name?",
      "Mike"
    );
    assert.match(out, /Mike/);
    assert.doesNotMatch(out, /your name/i);
  });

  it("stripTopicPush kills bait", () => {
    assert.doesNotMatch(
      stripTopicPush("Got it, Mike. What should we talk about today?"),
      /talk about/i
    );
  });

  it("hard quiet matches dont without apostrophe", () => {
    assert.equal(
      isHardQuiet("nothing man i dont want to talk with you"),
      true
    );
  });

  it("low signal does not catch I am aids / tired", () => {
    assert.equal(isLowSignal("nothing"), true);
    assert.equal(isLowSignal("i am aids"), false);
    assert.equal(isLowSignal("I am tired"), false);
    assert.equal(isLowSignal("already told you"), false);
  });

  it("name ask: pushback pauses once; otherwise keeps soft invite", () => {
    assert.equal(isNameAskPushback("you asked this already?"), true);
    assert.equal(
      isNameAskPushback("man you asked this why you keep asking ?"),
      true
    );
    const stripped = stripNameQuestion(
      "I ask to get to know you better. What's your name?"
    );
    assert.doesNotMatch(stripped, /name/i);
    const paused = ensureNameInvite("NEED_NAME", "What's your name?", "ASK_NAME", {
      nameNudges: 3,
      userText: "you already asked",
    });
    assert.doesNotMatch(paused, /name|call you/i);
    const kept = ensureNameInvite("NEED_NAME", "Got it.", "ACK", {
      nameNudges: 4,
      userText: "yea",
    });
    assert.match(kept, /name|call you|first name/i);
    const fake = ensureNameInvite("NEED_NAME", "Hi ..!", "GREET", {
      rejected: true,
      candidate: "..",
    });
    assert.match(fake, /doesn't look like a name/i);
    assert.doesNotMatch(fake, /^Hi\b/);
  });
});

describe("B — chat ingress routes (no provider)", () => {
  it("Mike-like sequence picks correct branches", () => {
    let eng = "normal";
    assert.equal(classifyChatIngress(eng, "yea"), "llm");
    assert.equal(classifyChatIngress(eng, "nothing"), "soft_quiet");
    eng = "quiet";
    assert.equal(classifyChatIngress(eng, "nothing ?"), "quiet_hold");
    assert.equal(
      classifyChatIngress(eng, "nothing man i dont want to talk with you"),
      "hard_quiet"
    );
    // After quiet, substance must still go to llm — NOT name onboarding
    assert.equal(classifyChatIngress("quiet", "i am aids"), "llm");
    assert.equal(classifyChatIngress("quiet", "already told you"), "llm");
    assert.equal(classifyChatIngress("quiet", "I am tired"), "llm");
    assert.equal(classifyChatIngress("normal", "you already know my name"), "llm");
  });
});

describe("C — name normalize", () => {
  it("mike ok; I am X strips prefix; nothing rejected", () => {
    assert.equal(validateName("Mike").ok, true);
    assert.equal(normalizeNameCandidate("my name is Jamal"), "Jamal");
    assert.equal(normalizeNameCandidate("my name is nothing?"), "nothing");
    assert.equal(validateName("Nothing").ok, false);
    assert.equal(validateName(normalizeNameCandidate("my name is nothing?")).ok, false);
  });
});

describe("D — age gate copy", () => {
  it("polish injects name; extract ages; soft invite", () => {
    assert.match(polishDeferredAgeAsk("By the way, how old are you?", "Jony"), /Jony/);
    assert.equal(
      polishDeferredAgeAsk("", "Jony"),
      defaultDeferredAgeQuestion("Jony")
    );
    assert.equal(extractAgeFromText("I'm 27").ok, true);
    assert.equal(extractAgeFromText("I'm 27").value, 27);
    assert.equal(extractAgeFromText("2+2").ok, false);
    assert.equal(validateAge("130").ok, true);
    const ack = ensureAgeInvite("Cool.", "ACK", {
      accepted: true,
      name: "Jony",
    });
    assert.match(ack, /Jony|Nice|thanks/i);
    assert.doesNotMatch(ack, /how old/i);
  });
});
