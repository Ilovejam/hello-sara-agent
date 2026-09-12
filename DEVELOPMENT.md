# Development history

This repository’s commits are ordered to show how the solution is layered — the same structure used in the live agent.

| Commit theme | What landed |
| --- | --- |
| Scaffold | Next.js app shell, tooling, env example |
| Validators | Deterministic name / duration / age checks + unit tests |
| Store + audit | Durable sessions (file / Upstash) + append-only event log |
| LLM + dialogue | Split schemas; app clock & identity facts outside the model |
| Session machine | `NEED_NAME` → `NEED_TIME` → `CHATTING` → `NEED_AGE` → `DONE` |
| HTTP APIs | session / message / deliver / events |
| UI | Live chat, countdown, refresh resume |
| Docs | Architecture + AI-usage disclosure index |

Live deployment: https://sara-timed-agent.vercel.app/

Coding assistant used during implementation: **Cursor** (see `AI-USAGE-DISCLOSURE.md`). Attach the full exported chatlog with the submission package.
