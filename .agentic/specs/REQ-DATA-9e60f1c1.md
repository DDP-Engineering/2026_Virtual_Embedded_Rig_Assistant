# Saved capture comparison

STATED in Gitea #333. Compare verified saved baseline and candidate traces offline and publish a
bounded result and local report with exact source evidence. The tool reads capture snapshots and
returns a generated Markdown report for local saving with the session artifact tool.

INFERRED from the normalized networking and traffic contracts. Each source selects a saved
section/interface and a half-open window in milliseconds relative to its first timestamped frame.
Declare the same duration for both windows. Select TCP, UDP or both, and declare the clock
uncertainty on measured durations in microseconds per side if known. The window must be
bracketed by timestamps at the selected point. Report observed duration, scan bounds, untimed,
truncated and dropped data. Keep frame drop counts and the maxima of saved interface and
operating-system drop counters separate. [PCAPNG interface statistics](https://datatracker.ietf.org/doc/html/draft-ietf-opsawg-pcapng-06#name-interface-statistics-block)
Packet counts and wire-byte volumes are directional. Presence is relative to the selected scope.

INFERRED from the networking contract. Match one transport stream per side by unordered exact
decoded IP addresses and ports, transport and ordered VLAN IDs. Streams and observation-point
numbers are local to each file. Duplicate tuple streams and unresolved frames are unmatched
evidence. Unbracketed or incompatible windows, incomplete scans, known drops, unknown timestamp
positions, clock regressions and scoped truncation prevent quantitative comparison. With unresolved
traffic, name affected transports and withhold their comparisons. If a native stream shares
dissection context across section, interface or VLAN observations, report the affected tuple as
unmatched and withhold its native retransmission and timing metrics. Retain observed coverage
and diagnostic representatives.

INFERRED from native traffic evidence. Count a TCP frame once when it bears a retransmission,
fast retransmission or spurious retransmission observation marker. Timing distribution samples
require in-window request and response frames in the same normalized stream and point, opposite
directions, and valid observed elapsed time. DNS uses corroborated native associations. HTTP
uses the supported native pairing and TCP contributor context. Timing uses sample count,
minimum, median, nearest-rank p95 and maximum. Cite the distinct request and response pairs
behind these order statistics, including both central pairs for an even sample count. Require
two unambiguous samples per side and declared clock uncertainty to compare distributions. Use the
sum of clock uncertainties as a tolerance for duration statistics.

INFERRED from the capture and citation contracts. Machine output includes exact SHA-256 capture
identities, effective options, outcome, metric values, diagnostic counts and bounded
representatives with verified #334 refs. Limits on shown rows leave explicit totals. The report
and structured view describe the same projection. Apply agent masking before regenerating the
model-facing report, and keep original citation paths in the private tool invocation record.
