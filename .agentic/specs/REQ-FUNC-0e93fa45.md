# Local workbench retrieval

STATED: WP26 and architecture05§4–6/8 plus ADR0015 define local CPU BGE,
384 float32 normalized values, batches32, top50 cosine, numeric chunk-id ties,
one-based RRF60 and the frozen hybrid gates24/28,14/14 EN,11/14 RO.

OBSERVED: KeywordSearch supplies persisted top50 lexical rows; Ingester owns
source/abort/lock checks and a single atomic publication transaction. Processor
retains full extraction in a verified content-addressed cache.

Search defaults hybrid/k8; k1..20. pathGlob is validated with the file-tool
glob policy and filters candidates before top50 ranking. Results carry exact
chunk locator/ref, snippet<=300 UTF16 characters and finite score. No indexed
chunks yields a message suggesting grep. Empty/punctuation lexical queries
return empty candidates. Semantic errors are actionable, with no remote fallback.

Model identity covers model/revision/dtype and the embedding descriptor. Intake
counts full prefixes and special tokens with the actual tokenizer, rejecting
inputs>=512 before inference. Model changes cause unchanged indexed documents
to be reprocessed; replacement commits chunks, extraction and vectors together.
A database with any schema_version other than 1 is invalid and does not open.
Tools never write SQL schema changes.

read_doc selects PDF page/pageEnd, Markdown/HTML heading slug or text lineStart/
lineEnd. Families cannot mix; bounds are positive integers within the extracted
source. Defaults: PDF page1, text lines1..end, heading documents first section.
It verifies confined current source hash before returning persisted full extraction.
Return complete locator units up to12000 characters; reduce page/line ranges
to fit and report the actual ref. An individual page/heading/line exceeding the
cap returns an actionable narrower-request error instead of an inaccurate ref.
PDF-only issued-reference validation is integrated for the required replay;
general reference-parser/chips/viewer extensions remain WP27/28.

CLI index opens an owned writable workbench, awaits reindex and reports status;
search opens through the same lock policy and searches the current snapshot.
Both close workbench and worker resources on all exits. eval:retrieval uses
production storage/rank/search/embedding paths over the same WP24 ordered corpus,
raw questions and unchanged expected locators and reports all three modes.
