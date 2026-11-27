---
name: git-release
description: Name the exact revision a firmware build came from, write release notes between two tags and tag a release. Use for versioning and traceability.
---

# git-release

describe --tags --dirty --always names the revision of the working tree: v1.2.0 is exactly that tag, v1.2.0-5-gabc1234 is five commits after it at commit abc1234, and a trailing -dirty means uncommitted changes were built in. Record this string next to every binary, flash and measurement report. A -dirty build cannot be reproduced from the repository: say so, and offer to commit first.

For release notes, describe --tags --abbrev=0 names the previous tag; log --no-merges --format=%h%x09%s <tag>..HEAD lists the commits and diff --stat <tag> HEAD shows where the change is. Group the entries by what a user of the firmware notices (features, fixes, hardware or protocol changes), keep the hashes, and save the notes with artifact_save or write them into the changelog file the repository already has.

Tag only a clean tree, and only after the user confirmed the version: tag -a <version> -m <summary> creates an annotated tag at HEAD; follow the repository's existing tag names (tag --list --sort=-creatordate). Publishing it is a separate request: push origin <version>. Never move or delete a tag that was pushed.
