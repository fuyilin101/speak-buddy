# AI Chat Performance Baseline — 2026-10-08

## Scope
This baseline measures end-to-end requests from the development host to `https://chat.101mcloud.com/api/chat`. It includes client/network/Worker/Qwen/D1 time together. It does not claim a model-only latency.

## Architecture found
- Frontend: React + Vite, `src/main.tsx`.
- Backend: Cloudflare Worker, `worker/index.ts`.
- Model API: Alibaba Bailian OpenAI-compatible Chat Completions endpoint.
- Current model: `qwen-plus`.
- Database: Cloudflare D1 `english-ai`.
- Chat chain: frontend `fetch` → Worker `/api/chat` → `chatService` → D1 memory read → local emotion/relationship rules → dynamic Prompt Builder → Qwen → D1 write → JSON response → frontend render.

## Baseline samples
The following were measured before performance changes with the same production endpoint and a fixed A2 teen profile:

| Scenario | End-to-end |
| --- | ---: |
| `Hello, how are you?` | 4488 ms |
| `What is the difference between HTTP and HTTPS?` | 5609 ms |
| `明天考试，好烦` | 5371 ms |

Observed sample average: **5156 ms**. These measurements include network and server time. No TTFT value was available because the endpoint returned one buffered JSON response.

## Findings
- Streaming: **not implemented**. `worker/ai/llm.ts` calls `response.json()`, so Qwen output is buffered until complete.
- Normal chat LLM calls: **one** main Qwen call. After the message count reaches the summary threshold, a summary call runs **before** the main call, so that turn can use two calls and summary latency blocks the reply.
- Emotion analysis: local regex/rules; no separate LLM call.
- Relationship state: local rules; no separate LLM call.
- Memory: one D1 profile query and one recent-message query, currently sequential inside `loadMemory`.
- Prompt building: local synchronous string composition; no model call.
- Artificial frontend typing delay: none found. The main delay is the buffered Qwen request plus network/Worker/D1 time.
- Token counts: not exposed in the current JSON response. The instrumentation now logs provider `usage.prompt_tokens` and `usage.completion_tokens` when deployed.
- TTFT: cannot be measured before Streaming; logs explicitly use `ttft_ms: null` rather than inventing a value.

## Instrumentation added locally (not deployed)
- Worker `llm_timing`: total Qwen call time, attempts, usage token counts, TTFT unavailable marker.
- Worker `chat_timing`: D1 memory time, prompt time, Qwen time, save time, total time, history length, call count.
- Frontend `[chat-timing]`: client-visible first render and complete render timestamps.

## Next stage
Implement a separate streaming chat endpoint using Qwen SSE and a Fetch `ReadableStream`, then have the frontend render the first usable reply text immediately while preserving final JSON parsing and D1 persistence. The current JSON endpoint should remain as a fallback until streaming passes regression tests.
