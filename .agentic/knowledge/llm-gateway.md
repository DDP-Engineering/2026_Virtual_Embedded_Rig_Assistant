# LLM gateway and provider connection tests

## Routing

Select for LlmGateway, model reference precedence, capabilities/budgets, providers.models/test, pi-ai, ReplayGateway, Test UI and smoke:live. Start at core/src/llm/{gateway,providers,connection}.ts under05_Software; focused tests are gateway.test.ts and replay.test.ts. [Providers](providers.md) owns stored credentials/configuration/consent; [IPC boundary](ipc-boundary.md) owns authorization and transport; [Agent runtime](agent-runtime.md) owns mandatory context reduction; [Providers](providers.md) routes ChatgptAuth and manual sign-in.

## Purpose and boundaries

Core resolves models and wraps exact-pinned pi-ai1.1.0. Desktop main supplies current settings, stored credentials, Clock and process-lifetime scrubbing, owns accepted-operation drain and records observed custom tool support. Shared projects strict non-secret catalogs and four-step results; renderer renders imperative local test state with en/ro/de/fr presentation. The mock exposes a small offline mock-openai fixture catalog and honors explicit model overrides/auth failure semantics.

## Public interface

- Curated connections resolve their registered HTTPS catalog URL independently of the inference base.
  Public models include the saved selection and plan-scoped catalog or registry entries as applicable.
  Chat and workbench share provider identity, context, input, tools and reasoning labels.
- QwenCloud Standard and Token Plan use fixed international HTTPS Chat Completions routes and
  scoped keys. A usable authenticated catalog adds that connection's IDs to the saved model.
  A catalog 401 or unsupported route permits manual entry while the inference test verifies the key.
  Qwen3.8 Flash and Qwen3.7 Max expose their documented inputs, tools and binary thinking options.
  Thinking-enabled tool continuations preserve the assistant's reasoning_content and call ID.
  Token Plan credit exhaustion is distinct from request throttling.
- DeepSeek and Moonshot AI use international Chat Completions with separate authenticated
  catalogs. Authenticated listings carry documented context and image fields, with maximum output
  and eligible effort levels where documented. A successful list governs unsaved model choices.
  DeepSeek passes its thinking toggle, and Moonshot K3 passes its effort level.
  Both preserve reasoning_content on tool continuations. Kimi For Coding uses overseas
  Anthropic Messages with x-api-key, VERA client identity, explicit model IDs and adaptive
  thinking. Thinking blocks and matching tool results survive continuation. DeepSeek tests
  with thinking off. Documented Moonshot and Kimi profiles test at low effort. The gateway leaves
  tool capabilities unverified when a manual preset probe uses an ID without a profile.
- The international MiniMax API and M Plan use the Messages adapter and scoped keys. M3.1 Flash
  leaves thinking enabled at the provider and sends selected effort. M3 supports the thinking
  toggle. Both replay signed thinking and the matching tool use. International Z.AI API and
  GLM Coding Plan use fixed Chat Completions paths. Documented GLM-5.3 profiles use preserved
  thinking and stream tools, and replay reasoning_content with matching tool results. Flash and
  GLM-5.3 presets probe with low effort and up to 4096 output tokens.
- Model Studio uses workspace-specific Chat Completions. Five listed regions also use their native
  workspace catalogs and Virginia offers explicit entry. Alibaba Cloud Coding Plan and MiMo Token
  Plan offer documented model suggestions and explicit entry. MiMo API lists documented chat IDs
  from its own authenticated model catalog. The Alibaba Qwen and MiMo profiles preserve tool results
  and reasoning content. The gateway pins this traffic to the selected route and reports scoped
  authentication or model availability errors. Model Studio reports missing workspaces separately.
  A Coding Plan Qwen3.7 Plus probe requests thinking on and uses a bounded reasoning budget.
- Fireworks AI selects serverless chat from a bounded, paginated native catalog and preserves
  account-qualified IDs. Together AI accepts its model array and the OpenAI list envelope.
  Groq uses active catalog rows and their token limits, excluding documented audio and
  moderation-only IDs. Cerebras lists IDs with its authenticated catalog and uses configured
  token budgets because published limits vary by account tier and deployment. Catalog fields
  and exact published model profiles supply tool and input capability labels. Missing
  metadata stays unverified. Hosted Chat Completions preserves scoped keys, streams and tool
  result IDs. Connection tests allow a 4096-token budget for documented reasoning models.
- OpenCode Console and Go use `https://opencode.ai/inference[/go]/v1/models` for the scoped catalog
  and `https://opencode.ai/inference[/go]/openai/v1/chat/completions` for inference. OpenCode’s
  catalog supplies eligible IDs, names, input modalities, limits and declared tool and compatible
  reasoning support. Non-chat models and known free Console models are excluded from discovery.
  Sparse entries retain their IDs and unknown capabilities. Saved catalogs cache per scoped key.
  Preflight enforces any advertised input ceiling. OpenCode reserves the configured or default
  output budget, capped by the advertised maximum and available context.
  A configured manual model can use the bound inference route when catalog permission is absent.
- OpenCode inference identifies VERA in its User-Agent and sends `x-opencode-session` from the VERA
  conversation ID, with a fresh ID for a probe outside a session. The gateway rechecks the binding
  and scoped key after catalog I/O before using them for inference. OpenCode key, model or plan, billing and rate-limit errors
  stay on the configured plan. Diagnostics distinguish catalog permission and budget exhaustion.
  OpenCode may use balance for Go Extra Usage according to the workspace’s billing settings.
LlmRequest.maskOutput is a host-owned live callback; omitted means on, including connection tests. SessionService supplies the agent choice, projects before context counting/compaction and revalidates the actual request budget after durable publication. Stream scrubbers hold split-secret tails while on; off passes content literally. message-scrub.ts preserves execution tool-call arguments at provider completion, and the session projects stored/request views separately. Provider errors and errorMessage diagnostics always use the unconditional scrubber. gateway.test.ts checks every agent/exports pair and live output policy.

- Replay steps optionally declare validated nonnegative integer usage.input and usage.output for deterministic numeric statistics acceptance. Omitted usage stays zero/unreported; totals sum the supplied counts, costs stay zero. Replay fixture parsing validates on scenario use, and replay.test.ts covers invalid measurements. Native prompt-usage.spec.ts exercises real model/tool steps, per-prompt projection and restart without live egress.

- prepareModel(reference,signal?) resolves live metadata before synchronous capabilities and budgeting. ChatGPT catalog discovery uses authenticated https://api.openai.com/v1/models; inference retains the pinned SDK public Responses route. Catalog IDs, context and native reasoning levels come from the server, including SDK-unknown models; no local model-specific reasoning allowlist or name heuristic. Codex Ultra is excluded as client subagent orchestration, not a public Responses effort. Unknown model prices have no SDK estimate. Live catalog models advertise strict-flag support so pi emits strict:false explicitly; optional VERA tool parameters remain optional instead of Responses normalizing an omitted strict flag.
- Account-scoped catalog memory is refreshed after five minutes (or the response's shorter Cache-Control) and on
  token/account changes, so per-iteration prepareModel calls reuse it without a request (REQ-NFR-4d0324ed), with superseded-publication protection. Individual caller abort detaches from a shared fetch. Optional reasoningOptions project declared levels; LM Studio uses discovered profiles, ordinary API-key catalogs with no declared levels expose none. LlmRequest.reasoning overrides the profile only when supported; Default leaves the provider/profile default. Responses use reasoning.effort. QwenCloud Chat Completions uses enable_thinking for the two documented profiles. Other Completions reasoning options use reasoning_effort.

- resolveModelReference(session,workbench,app), splitModelReference; LlmGateway selectedModel/capabilities/models/stream. Model IDs retain slashes; session wins over workbench over app.
- createPiAiGateway(host) exposes current OpenAI/custom API collection and OAuth-only subscription collection, mapping pi-ai openai to credential slot chatgpt. Host supplies settings, CredentialStore, scrub, now and optional fetch/knownSecrets.
- ChatGPT models carry chatgpt/<model> references and the same fresh budgets. Subscription requests resolve only stored OAuth, with locked refresh; API requests remain API-key-only. ChatGPT catalogs come from the authenticated live account catalog, while pi-ai owns subscription inference and refresh.
- capabilities expose input, contextWindow, maxOutputTokens, safetyMargin, inputBudget and optional tool and reasoning support. Custom configured limits are authoritative. OpenAI effective output is capped16384 and context-margin-1.
- Input modalities come from the ChatGPT account catalog and the pinned OpenAI model list. ChatGPT uses text when its catalog supplies no recognized modality. Custom models add image to text only for an exact enabled model ID in that connection's settings. Replay uses text. Both capabilities and providers.models expose the input list, and the shared acceptsImages helper checks it for image. The main provider gateway applies the same capability to a workbench draft through `providers.image.capability`.
- providers.models({id}) returns scrubbed catalog metadata. OpenAI default is offline static metadata; connection Test explicitly probes the endpoint. Custom catalogs validate discovered IDs against reference syntax and attach configured capabilities and fall back on404/405/501 only.
- providers.test({id,model?}) returns reachability/authentication/tools/streaming ordered pass/fail/skipped rows. Authentication failure skips downstream probes. Streaming requests a complete multiword sentence and requires multiple nonempty source text chunks; a single-token OK is sufficient for authentication, while one coalesced text chunk fails streaming. Tools requires an offered echo call with exactly the required string text and no extra properties.
- ProviderGateway tracks models/test, denies new calls after close and drains accepted work. ProviderSettings records tool support only for an unchanged writable configuration.
- ReplayGateway is an explicit core/replay test subpath: deterministic JSONL, filename or regex selection, transcript-derived steps, text and tool-argument deltas, artifact bindings and injected Clock. A named fixture can declare validated reasoningOptions on its first step and expectReasoning on a request step. A mismatch fails the replay before it emits a response. Model preparation validates named scenarios and preserves prompt matching for replay/auto. Optional request.sessionId isolates deterministic tool-call IDs across sessions; callers without it retain transcript-based IDs.
- smoke:live builds release and manually tests a stored real configuration through main; all required steps must pass, with unsupported listing optionally skipped. [Software README](../../05_Software/README.md) gives usage.

## Invariants

- Curated inference uses the pinned Chat Completions adapter and a request-local scoped key. It accepts
  the exact registered POST path. Curated catalog requests refuse redirects, bound response size,
  scrub the public result and honor cancellation. Request-local secrets are masked in text and tool
  deltas. With agent masking enabled, a terminal tool call containing a request-only key is refused
  before it reaches session processing. A successful tool probe can establish support for the saved
  model while its configuration and credential remain current. Curated limits merge the selected
  model's draft and known metadata at save. Other profiles use independent budgets.
- Main owns stored secrets; API OpenAI ignores ambient environment/OAuth keys, and subscription ignores API-key fallback. Custom requests use conservative compatibility and an optional-key placeholder.
- Per-request provider snapshots prevent concurrent requests crossing endpoints. Redirects are rejected; configured origin is enforced for stream fetches. Timeout30s, retry0, cancellation propagation.
- Provider errors map to OFFLINE or PROVIDER with auth/rate_limit/context/provider reasons, safe messages and optional Retry-After. With agent masking on, retained raw/escaped secrets are scrubbed across stream chunk boundaries and in final presentation messages; actual usage and protocol discriminants are preserved. Execution tool-call arguments remain raw authority while stored/request views project them; other assistant metadata/signatures follow agent masking, and successful/partial timestamps use host Clock at terminal emission.
- Shared strict projections and the existing authorized sandbox bridge guard catalog/result IPC. Renderer keeps no credential-bearing query mutation cache.
- Test registration and dynamic replay import reside entirely inside compiled __VERA_TEST__; release emission excludes their code. Automated Node and acceptance transports block non-loopback traffic before dispatch.
- The default model reference lives in settings schemaVersion 1. OpenCode and QwenCloud authenticated
  smoke is deferred by user ruling. Acceptance uses official documentation and scripted transport.

## Change map

| Change | Start | Focused verification |
|---|---|---|
| Model precedence/capabilities/catalog/auth/streams/errors | core llm gateway/providers/errors/stream-scrub | gateway.test.ts |
| Model input modalities | core llm providers/chatgpt-catalog and shared providers | gateway.test.ts, subscription.test.ts and shared providers.test.ts |
| Hosted model catalogs, isolated keys and tool continuation | shared hosted-provider-presets, core llm hosted-catalog and curated-adapters | desktop main hosted-provider-presets.test.ts |
| OpenCode and QwenCloud catalogs, scoped streams and diagnostics | core llm opencode, preset-catalog-cache, preset-connection and errors | desktop main opencode-presets.test.ts and qwencloud-presets.test.ts |
| Alibaba and Xiaomi route, workspace and protocol behavior | provider-presets, preset-connection, providers and errors | main regional-provider-presets.test.ts; tests/e2e/providers-layout.spec.ts |
| Four-step results and host lifecycle | core llm connection; main provider-gateway/provider-settings | gateway.test.ts; provider-test.spec.ts |
| Replay transcript and release seam | core llm replay; main index; Vite alias | replay.test.ts; tooling/build-mode.test.ts |
| IPC/schema | shared providers/ipc/errors/settings; core settings/service | bridge/router and service tests |
| Localized Test presentation/mock | renderer provider-test/providers/mockApi/locales/styles | mockApi.test.ts; tests/e2e/{provider-test,mock}.spec.ts |
| Guarded automation/manual smoke | tests/support/network-guard/network-setup; 02_Tools/release/smoke-live | tooling/network-guard.test.ts; manual real-provider observation |

## Key behaviors

- REQ-FUNC-790a052e — separate subscription catalog, fresh budgets and OAuth streams/refresh.

- REQ-FUNC-05ee1ae5/f3e5db81/5f2220ee/762c3864/29854976 — configured collections, selection, fresh budgets, safe catalogs and measured connection steps.
- REQ-FUNC-95c412df, REQ-FUNC-4dbd29dd, REQ-FUNC-59607b77 and REQ-FUNC-7ea3fa8c — model input modalities and the shared image capability query.
- REQ-SEC-647da472 — scrubbed structured failures and streamed/final output.
- REQ-TEST-38b20a35/771b99be/c986438f — deterministic replay, release seam elimination and automated egress rejection.
- REQ-UX-53628854 — localized accessible per-step results.
- REQ-FUNC-103979aa — manual real-provider smoke.

## Files

All paths are under05_Software.

- src/libraries/core/src/llm/{gateway,providers,chatgpt-catalog,connection,errors,stream-scrub,replay}.ts and {gateway,subscription,replay}.test.ts.
- src/libraries/core/{package.json,src/index.ts}; src/libraries/shared/src/{providers,ipc,errors,settings}.ts — dependency/export and strict contracts.
- src/apps/desktop/src/main/{provider-gateway,provider-settings,credentials,index}.ts — current-config host, capability persistence, secret registry and test composition.
- src/apps/desktop/electron.vite.config.ts — explicit replay source alias and compile-time test flag.
- src/apps/desktop/src/renderer/components/{provider-test,providers,error-message}.tsx; locales/{en,ro,de,fr}.json; styles.css; mocks/mockApi.ts and mockApi.test.ts.
- tests/support/network-{guard,setup}.ts; tests/tooling/{network-guard,build-mode}.test.ts; tests/e2e/{provider-test,mock}.spec.ts.
- 02_Tools/release/smoke-live.mjs; package.json/lockfile; core/desktop/root Vitest configs and tooling tsconfig — command, pinned dependency and guarded test wiring.
