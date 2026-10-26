# Skill discovery and admission

Sources: architecture02 §5,03 §3/4 and06 §2. Discovery uses workbench/.vera/skills and host-authorized userData/skills. Workbench folders shadow user folders even when invalid. Names match `[a-z0-9-]{1,64}` and folder; descriptions contain 1–1024 characters. YAML frontmatter is bounded and parsed without aliases. Body remains out of metadata/prompt. Empty Markdown is allowed by02; the reference's additional body-line cap is not a product rule.

Admission bounds: 256 KiB UTF8 per SKILL.md or extra text file; 1024 discovered folders and4096 scanned entries per root. Reject symbolic/redirection components, nonregular and multiply linked files, binary/invalid UTF8, ambiguous Windows paths and escaping paths. Extra paths are relative to the selected skill folder. Oversize/invalid skills have visible error metadata and cannot load. Explicit error when discovery exceeds its bound rather than silently omitting skills.

Every turn gets freshly resolved enabled metadata and a loader tied to its current workbench/user roots. Loader revalidates metadata and disabled state; late abort or ownership change discards results. Settings operations carry workbench ID and source, serialize against lifecycle and writes, recheck admission and ownership around async work. Creation is exclusive; edits compare the original content digest. User edits use only the separately authorized root while respecting workbench mutation admission. Read-only permits inspection only. Editor drafts are scoped by workbench and a fresh dialog load; cancel/save restores focus.

Verification: discovery/clash/invalid/disabled and path/content bounds units; replay loads body plus extra; native UI creation changes next-turn system request; browser matrix en/ro/de, light/dark, five text sizes at1024x640.

Agent reads honor permanent .git/.vera/node_modules exclusions under both roots and
workbench .vera/.veraignore rules, including negations, through the existing PathGuard.
Ignored primary skills have unavailable diagnostics and stay out of the prompt;
UI inspection/editing retains its explicit ownership admission. Load rechecks ignore
rules around content reads so late exclusion changes prevent disclosure.
