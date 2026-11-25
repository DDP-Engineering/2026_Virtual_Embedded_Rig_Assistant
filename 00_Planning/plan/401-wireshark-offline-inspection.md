# #401 Wireshark offline inspection

First work package in epic #400, following the official TShark delivery in #71.
Source: [Gitea #401](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/401).

- Compose a host-owned offline service through VERA's official plugin, program discovery, permission
  and path boundaries. Offer capabilities, capture inspection, field and protocol discovery,
  display-filter validation, packet pages and single-frame details.
- Define capture and frame identity, dissection context, scoped coverage and partial results for #334
  and other epic work. Bind page cursors to the exact capture and query. Own native options and
  the dissection profile in the host, including typed Decode As and limits on returned packet data.
- Stage, validate and publish managed PCAP/PCAPNG under verified paths with streaming hashes and
  quotas. Use the existing session artifact store for small text reports.
- Verify independent PCAP/PCAPNG fixtures, filter recovery, paging, exact reopened references,
  invalid and over-budget inputs, partial output, model replay and native Windows/Ubuntu execution.
  Use focused validation for this ticket.
