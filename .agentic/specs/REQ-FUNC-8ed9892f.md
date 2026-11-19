# Local dictation model acquisition

## Storage and inputs

Desktop owns `userData/dictation-models`. Its catalog fixes the model id, revision, Apache-2.0
license, ONNX data type, inventory, total derived bytes and SHA-256 per file. The
download source is each fixed HTTPS pinned Hugging Face revision. Redirects are bounded and
restricted to approved HTTPS origins. Requests carry no credentials, user inputs or user data.

Each model occupies the directory named by its id. Pending transfers use
`.<id>.stage` and pending removals use `.<id>.removed`. The installed namespace is the
catalog directory only. The model tree contains the exact catalog files and the `onnx`
directory. Symlinks, extra entries and length or hash mismatches make it unavailable.

## Lifecycle

- Download begins for a model with missing or corrupt files. One model transfer is admitted at a
  time. Byte progress reflects streamed artifacts. Known insufficient space, HTTP/network errors,
  integrity errors and other storage errors yield an explicit retryable failure.
- The host rechecks the staged bytes and inventory before renaming the staging directory to
  the installed name. Cancellation before publication discards staging. Startup cleans abandoned
  staging. Verified installed models remain available offline.
- Only a verified installed model can be selected. A stored selection is effective while its files
  are available. Removing it clears the preference and removes its files. If saving the preference
  fails, the service moves the directory back to its installed name. Startup completes interrupted
  removal and clears the corresponding preference before removing the abandoned directory. A locked
  removal remains visible with a removal retry. It is unavailable to selection and replacement.
- Format-1 settings optionally hold dictation language and selected model id. The initial state is
  automatic spoken language and no model selection. Changing either preference preserves the other.
- `dictation.get` and `dictation.change` expose effective settings and bounded catalog state.
  The trusted main-side resolver revalidates the selected files and provides the id, local directory,
  data type and language for transcription. The renderer supplies action and model id or language.

## Verification

Use the focused Windows lifecycle, IPC and localized Settings tests. Check exact pinned files
and multilingual generation configs against the two immutable model revisions. Exercise
real acquisition and reopen with network unavailable to the model service.
