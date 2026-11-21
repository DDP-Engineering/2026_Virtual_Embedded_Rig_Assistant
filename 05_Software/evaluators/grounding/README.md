# Grounding evaluation: document answers, citations and abstention

Asks the agent factual questions about the fictional demo board and checks, from the events alone,
whether it answers correctly, cites the right page, searches the documents first, answers in the
question's language and refuses to invent values the documents do not contain. The checks follow
the system prompt rules in `core/src/agent/prompt.ts`: cite claims, `search_docs` first, never
guess pins, registers, voltages or timings, search in English, answer in the user's language.
Layout and shared rules: [evaluators README](../README.md).

## Cases

[cases/demo-board.yaml](cases/demo-board.yaml), frozen before the first model run:

- **28 answerable** questions, the English and Romanian pairs of the retrieval family, each with the
  expected values (all must appear in the normalized answer) and the citation targets: the PDF page,
  or the English Markdown source of the same document in `sources/`.
- **12 unanswerable** questions about values the demo documents do not contain (SPI clock, buzzer
  pin, EEPROM address, absolute maximum voltage, ...), often next to a documented value (`nearMiss`).

## Metrics

| Metric | Per repeat |
|---|---|
| Fact accuracy | every expected value pattern matches the normalized answer (decimal commas, dashes and spaces unified) |
| Valid citation, on target | at least one `[[ref]]` with `valid: true`; one of them points to an expected document and page |
| Valid citations | share of the answer's citations that VERA verified |
| `search_docs` first | `search_docs` ran, and before any web tool |
| Language | the answer's language (function words and diacritics, quotes ignored) is the question's |
| English search | for a Romanian question, every `search_docs` query is English |
| Grounded | every technical value of the answer (hex, pins, quantities with units) appears in the prompt, `WORKBENCH.md` or a successful tool result of that run |
| Abstention, fabrication | for an unanswerable case: the answer says the documents do not contain it; fabrication means it states a value the model never saw |

An answerable case passes with a correct, grounded answer cited on target; an unanswerable one with
an abstention and no fabricated value. The report adds the accuracy and citation matrix, the results
per language and every value stated without evidence.

## Thresholds

Proposed from the first local run and to be revisited with every new reference model:

| Threshold | Limit |
|---|---|
| Fact accuracy (answerable) | ≥ 85 % |
| Citation on the expected page (answerable) | ≥ 60 % |
| Fabrication rate (unanswerable) | ≤ 10 % |
| Abstention (unanswerable) | ≥ 80 % |

First run, 2026-11-21, `qwen/qwen3.8-27b` Q4_K_M, 32 K context, reasoning `low`, 3 repeats (scored
with the current scorer through `rescore`): fact accuracy 98.8 %, valid citation 81.0 %, on target
78.6 %, answer language 100 %, English search for Romanian questions 83.3 %, abstention 91.7 % and
fabrication 16.7 %, which fails its threshold. The fabricated values are general knowledge, not the
demo documents: `0xCCCC` as the watchdog start key, `0x50` as an EEPROM address, `0x14` as an
I2C1_OAR1 offset, 300 ns and 400 pF for SCL rise time. Of 42 invalid citations, 37 used the
`[[ref|label]]` form, which VERA does not accept; one wrote the template `[[ref]]` literally.

## Commands

```powershell
python ../02_Tools/environment/npmw.py npm run eval:grounding -- run --base-url http://127.0.0.1:1234/v1 --model qwen/qwen3.8-27b --reasoning low
python ../02_Tools/environment/npmw.py npm run eval:grounding -- run --provider replay --repeats 1 --cases sensor-address-en,spi-clock-en
```

Web tools are off by default, so `search_docs` first is trivially true unless a run passes
`--web on`; that variant sends search queries to the configured web provider.

## Limits

- Grounding is lexical: a value counts as seen when the same canonical value occurs in the evidence,
  even if the answer attaches it to the wrong signal. Fact accuracy and the target check cover that.
- Language detection uses short word lists; very short answers can be `unknown`.
- Cases, scoring and the focused tests (`tests/tooling/eval-grounding.test.ts`,
  `tests/integration/eval-grounding.test.ts`) change together; a changed case file makes earlier
  runs incompatible.
