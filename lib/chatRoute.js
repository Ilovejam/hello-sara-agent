/** Pure ingress decisions for CHATTING — testable without provider. */
import { isHardQuiet, isLowSignal } from "./openai.js";

export function classifyChatIngress(engagement, text) {
  if (isHardQuiet(text)) return "hard_quiet";
  if (engagement === "quiet" && isLowSignal(text)) return "quiet_hold";
  if (isLowSignal(text)) return "soft_quiet";
  return "llm";
}
