# Upgrade safety acceptance (retired)

Retired 2026-11-01. The requirements that pointed here are retired.

Upgrade and migration safety (00_Planning rule L10, WP-32) is deferred until the first public
release. During development every stored format stays at version 1, and any other version is
invalid data. The settings migration chain, the workbench database migrations and backups, the
newer-data refusal UI, the upgrade fixtures and the installed-upgrade proof were removed.

Crash recovery of interrupted sessions is current behaviour. Its fixture is
`05_Software/tests/fixtures/app-data/interrupted-sessions.json`.
