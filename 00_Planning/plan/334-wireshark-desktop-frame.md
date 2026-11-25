# #334 Open the cited frame in Wireshark Desktop

Epic #400. Depends on the saved capture and frame reference delivered by #401.
Source: [Gitea #334](http://192.168.1.15:3001/dpasare/2026_Virtual_Embedded_Rig_Assistant/issues/334).

- Provide a localized user action on verified saved-capture evidence in VERA Desktop. Resolve
  the reference against its workbench, verify file identity and frame association, and use the
  derived file's own frame number when evidence cites a derived capture.
- Find the native Wireshark Desktop installation on Windows and Ubuntu and pass the verified file,
  frame and applicable display filter as separate arguments. Keep a frame visible when the
  requested filter hides it and explain the adjustment. Diagnose stale references, unavailable
  files or executables, invalid filters and launch failures.
- Exercise the offline path from #401 evidence through the VERA action with controlled PCAPNG
  fixtures, including Unicode and spaces and a derived capture. Run focused and static checks,
  strict AEGIS and independent reviews on Windows. Native Ubuntu acceptance and the full suite
  belong to the final cycle verification, as directed by the user.

## Done criteria

- The VERA action opens an exact source frame and an independently renumbered derived frame on
  native Windows, using PCAPNG paths with spaces and Unicode.
- A matching display filter remains in use. A hiding filter includes the cited frame and reports
  the adjustment. Invalid, stale and unavailable references receive a diagnostic.
- Native proof starts at the offline inspection tool, passes through a completed assistant citation
  and exercises the user action. Focused tests and strict checks cover the changed boundaries.
