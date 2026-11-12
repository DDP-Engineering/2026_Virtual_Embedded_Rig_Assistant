# Firmware comparator verification

The automated replay in `tests/integration/cli.test.ts` uses the actual SessionService, folder-installed
plugin, log workers, indexed documents and npm-built CLI. It checks successful tools, issued citations
and actual stored artifact bytes. Its scripted prose proves wiring, not model semantics.

The separate opt-in rubric uses a real configured ChatGPT model through the production
CredentialFile, Electron safeStorage, subscriptionStore and createPiAiGateway. It creates no keys or
accounts. Electron initializes the normal profile's encryption context only to load credentials, then
switches to its isolated test profile; normal OAuth refresh can update the credential file. Settings
and user workbenches are never edited. Settings hashes before/after are retained. The user explicitly
selected `chatgpt/gpt-6.1-sol` for isolated sessions after live catalog discovery showed that the profile's
`chatgpt/gpt-4` default was absent; the default remains unchanged.

From `05_Software`, with the repository's pinned Node runtime:

```text
node evaluators/eval-firmware-comparator-harness/firmware-comparator-rubric.mjs --prepare ABS_NEW_OWNED_OUTPUT
node evaluators/eval-firmware-comparator-harness/firmware-comparator-rubric.mjs --run ABS_NEW_OWNED_OUTPUT ABS_EXISTING_VERA_PROFILE chatgpt/gpt-6.1-sol
```

The output must be new; preserve each attempt. All seven fixtures, prompts, source hashes and pending
criterion rows are prepared before provider access. A fifth optional argument selects a comma-separated
subset of case IDs for an explicitly required rerun. The tool never selects another model automatically.
Original outputs contain model catalog metadata, executed host bundles, each system/user prompt, actual
events and snapshot, any saved artifact, model/provider/API reported by the gateway, body/template hashes
and egress/profile-integrity receipts. If the provider does not report a separate immutable model
revision, record that limitation rather than inventing one.

Outbound Node fetch is restricted to HTTPS `api.openai.com/v1/models`, `api.openai.com/v1/responses`
and the normal `auth.openai.com/api/accounts/oauth/token` refresh endpoint, with redirects refused.
The session has no program host or web/write/edit/install tools. Each case is limited to100 tool calls,
90seconds without output and10minutes overall. There are no automatic reruns. Credentials remain in
the normal host's memory/store and never enter repo evidence. Test data is fictional.

Two cases deliberately inject faults in the fixture host while keeping the model real:

- Incomplete scan: an actual worker parse supplies the first two captured events, exposed as a
  timeout prefix with no complete-source SHA. This measures model treatment of partial evidence;
  it is not a benchmark of the production worker deadline.
- Changed log:264 captured events exceed the maximum200-event preview. After the first real parse,
  the host appends a line to the actual fixture; a pinned follow-up uses the real worker's SHA check
  and must return `CONFLICT/source_changed`.

Read each complete real transcript and artifact to grade every criterion in the generated rubric.
Check source citations and stored bytes; do not equate process exit0, fluent prose or replay with a
semantic pass. An ambiguous-run case should ask the user and save no completed comparison.

The [results ledger](results.json) records seven passing cases and34 criterion verdicts, exact prompts,
six saved reports and the ambiguity question. It also retains failed attempts. In particular,
ambiguous06 constructed two unissued subranges and failed exact-citation validation. Three lines
were added only to the ambiguity-question branch; an identical-prompt run on fresh07 fixtures passes.
The six explicit-pair cases from06 are reused with their original skill hashes because that branch
did not change, as both independent reviewers confirmed. Every final answer and artifact-body ref
was checked against structured refs from successful tools, and artifact bytes against saved hashes.

Original Windows and UbuntuWSL2 proof remains in task-owned proof roots named by TASK-86a7c2d9. Native Ubuntu
acceptance is not implied by WSL2. The aggregate Analysis capabilities `npm run verify` gate belongs
to CAP04/coordinator, once after the epic, under `02_Tools/verification-policy.md`.
