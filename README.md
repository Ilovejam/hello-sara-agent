# hello-sara

Assignment 1 — **Hello Sara!**

**Flow (PDF):** Name → ask how much time you need → wait that duration → Age → done.

| Deliverable | Link |
| --- | --- |
| Live chat | https://sara-timed-agent.vercel.app/ |
| Source | this repository |
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| How it was built | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| AI usage disclosure | [AI-USAGE-DISCLOSURE.md](./AI-USAGE-DISCLOSURE.md) |

## Quick start

```bash
cp .env.example .env.local
# OPENAI_API_KEY=...
npm install
npm run dev   # http://localhost:8787
```

## Design contract

- **Language** → OpenAI (`gpt-4.1-mini`)
- **Clock / deadline** → server `dueAt` (never poll the model for time)
- **Deferred age ask** → pre-stored utterance; deliver path = **0 LLM**
- **No chat history** replayed to the model
- **Audit log** (ops only): `GET /api/session/:id/events`

## Edge cases covered

- Invalid duration (`later`, `soon`)
- Invalid age
- Page refresh mid-flow (session + `localStorage`)
- Chat during the wait (timer does not reset)
- Multi-offer: `My name is John and I need 3 minutes`
- Sentence-as-name rejected; `my name is not …` clears a bad name

## Tests

```bash
npm test
```
