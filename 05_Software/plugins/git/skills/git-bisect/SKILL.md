---
name: git-bisect
description: Find the commit that introduced a regression by testing revisions between a good and a bad one. Use when something worked in an earlier version and no longer does.
---

# git-bisect

Agree on three things with the user before starting: the test that tells good from bad (a build, a unit test, or flashing the board and watching one behaviour), a revision known to be good (usually a release tag) and one known to be bad (usually HEAD). The working tree must be clean: check status --short and ask the user to commit or stash first. rev-list --count <good>..<bad> gives the number of commits; expect about log2 of it in steps, and say so. When each step flashes hardware, get the user's agreement for the whole search once.

Start with bisect start <bad> <good>. At every step: note rev-parse --short HEAD, run the agreed test with the plugin that owns it (the build, flash, serial or test tools), then answer with bisect good or bisect bad. Use bisect skip when a revision cannot be built or tested at all. Judge only by the agreed test; an unrelated failure is a skip, not a bad. bisect log shows the answers so far.

Git ends with "<hash> is the first bad commit". Show it with show --stat <hash>, read the relevant diff and explain what in it causes the regression. Always finish with bisect reset, also when the search is stopped early: it returns to the branch you started from. bisect run is not available; VERA runs each test itself, so every step is visible in the conversation and its run log.
