# AI usage disclosure

**Requirement (Assignment 1 PDF):** full chatlog of any LLM used for coding (prompts + answers), plus other tools.

## Coding assistant

- **Primary:** Cursor (Composer / agent mode)  
- **Human:** Osman (GitHub: Ilovejam)

## This file vs the full log

This file is the **index**. The submission package must also include the **exported Cursor chat transcript(s)** (prompts and answers in full).

Local transcript reference (dev machine):  
`~/.cursor/projects/Users-ilovejam-Documents-Obsidian-Vault/agent-transcripts/`  
Thread used heavily for this build: `0a9c70d4-90f2-4f59-9721-d63d84fcafff` (and follow-ons).

## Runtime model (the product)

- OpenAI **`gpt-4.1-mini`** via API — used by the live agent for language turns, not as the coding assistant.

## Other tools

| Tool | Use |
| --- | --- |
| Cursor IDE | Implementation, debugging, tests |
| Node.js test runner | `npm test` |
| Upstash Redis | Vercel session + audit persistence |
| Vercel | Live deployment |
| GitHub | Source deliverable |
| `pdftotext` | Read Assignment 1 PDF |

## What the coding AI helped with (summary)

- Deferred-intent / server-owned `dueAt` design  
- Schema split and dialogue hardening  
- PDF alignment: user-chosen duration + multi-offer  
- Audit log, refresh resume, name-quality gates  
- Layered repository presentation for clear commit history  
