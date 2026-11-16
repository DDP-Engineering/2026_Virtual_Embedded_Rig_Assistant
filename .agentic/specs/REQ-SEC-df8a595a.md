# REQ-SEC-df8a595a — Workbench-owned Display identities

## Behavior

Display identities transport original authority separately from displayPath/displayRef labels.
The existing workbench/path/citation guards still authorize every resolved operation. Possessing
an identity does not widen the workbench, additional-folder or application-data boundaries.

## Data / interface

- userData/display-identities.json is a strict format-1 object with schemaVersion: 1 and key:
  64 lowercase hexadecimal characters (32 random bytes). Invalid data fails INVALID. New keys
  are written with exclusive creation and mode 0600; existing keys are reused across app restarts.
- Owner is the validated workbench ID, newline and canonical workbench folder. For path segments,
  AES-256-GCM AAD is JSON([owner, originalParent]); the 12-byte nonce is the first bytes of
  HMAC-SHA256(key, JSON([owner, originalParent, originalSegment])). Payload is nonce, 16-byte
  authentication tag, ciphertext, encoded as canonical unpadded base64url.
- An opaque path segment is __vera_display_<payload>. with the final dot required. The existing
  host guard refuses ordinary source segments ending in a dot, keeping valid source paths and
  identities disjoint. Unchanged ordinary prefix names, such as __vera_display_notes, stay raw.
  Sensitive prefixes, or literal segments shaped like identities, are encoded; after the first
  encoded segment all descendants are encoded. Decryption authenticates each original parent.
- An opaque document ref is <projectedPath>/__vera_reference_<payload>.#L1-L1. Here the encrypted
  plaintext is base64url(UTF8(originalRef)); owner domain is owner + newline + reference:originalPath.
  The final locator must be exactly L1-L1, and the decrypted original must parse and name exactly
  the authenticated original path. Original heading/page/line locators remain inside the payload.
  Renderer tab keys remove only this final reference segment, preserving one tab per source.
- Ordinary refs retain their path/locator meaning. Session-citation requests pass the original ref
  to SessionService.openCitation, which checks exact assistant citation and successful tool
  provenance; the Display boundary checks the returned original ref before projection.
- Original paths are bounded to 4096 characters and original refs to 8192. IPC and format-1
  stored opaque targets allow 262144 characters, with room for tab-key prefixes in active keys.
  Oversized ordinary/session original refs fail INVALID before host access; malformed opaque
  payloads fail NOT_FOUND. No credential values or original sensitive path strings are added to
  response authority fields.
- A read captures the current owner/generation before awaiting and checks them again before
  publication. Closed or switched workbenches fail CONFLICT. Malformed or foreign opaque
  identities fail NOT_FOUND before file access. Existing confinement failures retain their codes.

## Examples

- A stored-secret filename has the same opaque path with Display off/on, but different labels.
- __vera_display_notes/child.txt is an ordinary original path, including in a core-issued citation.
- Moving a valid encrypted segment to another parent/workbench fails authentication.
- Altering the wrapper locator or moving a reference token to another path fails NOT_FOUND.

## Acceptance

Focused identity/host/schema/component tests and the native replay fixture verify equal counts,
exact original-path/ref checks, collisions, live choices, cached-scope invalidation, current-format
raw-target restart restoration, ordinary prefix names and authenticated core-issued citations.

## Assumptions and open decisions

The host-local key and application data stay inside existing protected roots. Formats remain 1;
pre-release data is changed in place, with no migrations or compatibility readers.
