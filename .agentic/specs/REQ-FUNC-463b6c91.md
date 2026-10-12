# Persisted keyword search

Migration 2 adds external-content chunks_fts (unicode61 remove_diacritics 2,
underscore token character) and chunks_tri (trigram), rebuilds both from existing
chunks, and synchronizes insert/update/delete through SQLite triggers. The
initial migration remains immutable. The existing migration runner owns backups,
checksum checks, rollback and read-only compatibility.

DocumentsRepository deletes chunks once; triggers own FTS removal, including
document FK cascades. Derived embedding cleanup remains repository-owned.
Replacement and explicit derived cleanup/removal are transactions; ingest's
outer transaction also publishes metadata atomically.

KeywordSearch.search(query) returns up to 50 ranked candidates with id, docId,
ordinal, path, typed locator, complete chunk text, bm25 and one-based rank.
Tokenize query into Unicode letters/numbers/underscore (including combining
marks attached to tokens), quote literals and OR terms; punctuation alone yields
an empty list. MATCH is bound as a parameter; query syntax is never executed.
Word candidates rank by ascending bm25 then numeric chunk id. Trigram candidates
use terms of at least three Unicode code points containing an ASCII digit or
underscore, ranked by ascending bm25 then id. Each list is capped at 50.
When fragments exist, combine these two lists with RRF60 (one-based ranks,
deduplicated ids, descending score then numeric id) and cap the union at 50,
following the frozen WP24 keyword convention. Without fragments preserve word
bm25 order. bm25 is the best available raw lexical score; rank is the downstream
fusion interface. Search is a synchronous read of persisted indexed chunks and
their document paths/locators. Read-only schema1 yields no keyword candidates;
writable opening upgrades it through the migration runner.

Embeddings, semantic/hybrid services, snippets, refs/tools/CLI/UI and retrieval
gates belong to later work packages.
