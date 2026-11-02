# Program rule matching and approval policy

Governs REQ-FUNC-5bb9429f, REQ-FUNC-80b2033a, REQ-FUNC-2819a97e, REQ-FUNC-9ca99463,
REQ-SEC-28b53f44, REQ-FUNC-8d305364, REQ-SEC-94998c85, REQ-SEC-2b4bcdf5 and REQ-SEC-e8695b28.
Implemented in `05_Software/src/libraries/shared/src/program-rules.ts`.

## 1. Tokens

The command line is the program name followed by the agent's arguments only: a launcher, a download
`prefix` and a program `prefix` are never part of it. Before matching:

1. An argument of the form `--name=value` (two leading hyphens, a non-empty name, the first `=`)
   becomes two tokens, `--name` and `value` (`value` may be empty). A single-dash `-d=x` stays one
   token. The program name is never split.
2. Each token is lowercased (`toLowerCase`) and every `_` becomes `-`.

Each token remembers the index of the argument it came from (`-1` for the program name), so a
confirmation word can be read back and file arguments can be named.

## 2. Patterns

A rule's `match` is split on runs of whitespace. Each pattern token is first split like an
argument (rule 1) and normalised (rule 2), then read as:

| Token | Kind | Matches |
|---|---|---|
| `*` | any | zero or more command tokens |
| `{a,b,…}` | alternatives | one token equal to an alternative, or starting with it when the alternative ends in `*` |
| `text*` (not `*` alone) | prefix | one token starting with `text` |
| anything else | literal | one equal token |

An alternative list with an empty or `*` entry (`{a,}`) or without its closing brace is read as a literal.
A pattern matches only when it covers the whole token list (anchored at both ends). Matching uses
memoised backtracking over (pattern position, token position). A `*` that fails from token t fails
from every later token, so each `*` tries each continuation once and the cost is bounded by pattern
tokens × command tokens.

## 3. Classification

- Every rule of the declaring plugin is tried. Rules whose first pattern token does not match the
  program name never match, so rules for other programs of the same plugin are ignored naturally.
- Risk: the highest of all matching rules in the order `blocked` > `irreversible` > `device-write`
  > `device-read` > `safe`. No matching rule: `device-write`.
- Notes: the `note` of every matching rule, in manifest order, each text once.
- Confirmation word (irreversible only, else `null`): in the first matching rule whose risk is
  `irreversible`, the command token matched by the first non-`*` pattern token that matched a token
  other than the program name; when the pattern has no such token, the normalised program name.

## 4. Pre-rule refusals

Checked on the raw arguments, in this order, before any rule: more than 64 arguments (`count`);
then per argument, first failing one wins: longer than 4096 characters (`length`), contains NUL,
CR or LF (`control`), starts with `@` (`argument-file`). Failure is DENIED with
`params {reason, index?}`.

## 5. Policy

`programPolicy(mode, risk, trial)` returns one of `run` (no approval record), `refuse` (the gate
returns `aborted`, no record), `mode` (a record approved by mode), `user` (pending until the user
decides) or `confirm` (pending; the user's approval needs the typed word).

| Mode | safe | device-read | device-write | irreversible | blocked |
|---|---|---|---|---|---|
| read-only | run | refuse | refuse | refuse | refuse |
| ask | run | user | user | confirm | refuse |
| auto-edit | run | mode | user | confirm | refuse |
| bypass | run | mode | mode | mode | refuse |
| any mode, trial plugin | read-only: refuse; else user (irreversible: confirm) | | | | refuse |

## 6. Typed comparison

`confirmationMatches(word, typed)`: `typed` trimmed, lowercased and `_` → `-`, then compared with
`word` for equality. An empty or missing `typed` never matches.
