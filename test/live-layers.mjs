/**
 * Live layer probe — real provider vs paint/state.
 * Does NOT invent expected model text. Prints what the API actually returned.
 *
 * Usage: node --env-file=.env.local test/live-layers.mjs
 * Skip: exit 0 if no OPENAI_API_KEY
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as llm from "../lib/openai.js";
import { normalizeNameCandidate, validateName } from "../lib/validate.js";
import {
  parseNameUpdate,
  classifyFactAsk,
  answerFactAsk,
} from "../lib/dialogue.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.log("SKIP live-layers: no OPENAI_API_KEY");
  process.exit(0);
}

function row(title, obj) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(obj, null, 2));
}

// Case A: my name is ..
{
  const userText = "my name is ..";
  const out = await llm.nameTurn(userText, { nameNudges: 2 });
  const candidate = normalizeNameCandidate(out.data.nameCandidate || "");
  const check = validateName(candidate);
  const painted = check.ok
    ? out.data.replyNow
    : llm.rejectNamePaint(out.data.replyNow, candidate);
  row("A my name is ..", {
    provider: out.data,
    validate: check,
    painted,
    layerBugIf:
      !check.ok && /^hi\b/i.test(painted)
        ? "PAINT leaked accept"
        : "ok (paint != accept or validate ok)",
  });
}

// Case B: name flip — runtime only (no provider needed for the bug)
{
  let name = "Jony";
  const u1 = parseNameUpdate("no my name is jack", name);
  if (u1?.type === "set") name = u1.value;
  const u2 = parseNameUpdate("not johny", name);
  row("B Jack → not johny (runtime)", {
    afterJack: name,
    secondUpdate: u2,
    wouldShowIfLlm: "Got it, Jony. (OLD BUG — LLM path)",
    nowRoute:
      u2?.type === "reject_other"
        ? `Okay — you're ${name}.`
        : u2?.type === "reject_current"
          ? "ask instead"
          : u2,
    sessionNameUnchanged: name === "Jack",
  });
}

// Case C: identity — runtime fact, plus what LLM would have said
{
  const userText = "what is your name?";
  const fact = answerFactAsk(classifyFactAsk(userText));
  const llmOut = await llm.chatTurn({
    name: "Jony",
    quiet: false,
    userText,
    openThread: null,
    clock: null,
  });
  row("C assistant identity", {
    runtimeAnswer: fact.content,
    providerWouldSay: llmOut.data.replyNow,
    note: "Production uses runtimeAnswer; provider shown for comparison only",
  });
}

// Case D: time
{
  const userText = "what time is it now?";
  const fact = answerFactAsk(classifyFactAsk(userText));
  const llmOut = await llm.chatTurn({
    name: "Jony",
    quiet: false,
    userText,
    clock: null,
  });
  row("D time", {
    runtimeAnswer: fact.content,
    providerWouldSay: llmOut.data.replyNow,
  });
}

console.log("\nLive probe done.");
