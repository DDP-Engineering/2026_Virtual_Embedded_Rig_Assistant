import type { CaptureComparisonResult } from "@vera/shared";

type View = CaptureComparisonResult["comparison"];
type Row = View["rows"][number];
type Observation = NonNullable<Row["baseline"]>;
const labels = {
  en: [
    "Saved capture comparison",
    "Baseline",
    "Candidate",
    "TCP/UDP scope",
    "Outcome",
    "Observed duration",
    "Relative window",
    "Section/interface",
    "Clock uncertainty",
    "Diagnostics",
    "Rows omitted",
    "Packets / wire bytes",
    "TCP retransmission observations",
    "samples / unpaired / min / median / p95 / max (ms)",
    "Matched / added / missing / changed / unmatched / timing unavailable",
    "Timing withheld",
    "Exact IPs and ports, transport, ordered VLAN tags and one stream per tuple",
    "Relative to the first timestamped frame. Start included, end excluded",
    "Scanned / selected point / in transport scope / outside scope / untimed / truncated / unresolved / packet drop count",
    "Timing tolerance",
    "Scan limit per capture",
    "Interface / operating system drop counters",
    "Unresolved transports",
    "Conversations with shared native stream context",
  ],
  ro: [
    "Comparație între capturi salvate",
    "Referință",
    "Candidat",
    "Domeniu TCP/UDP",
    "Rezultat",
    "Durată observată",
    "Fereastră relativă",
    "Secțiune/interfață",
    "Incertitudinea ceasului",
    "Diagnostic",
    "Rânduri omise",
    "Pachete / octeți pe fir",
    "Retransmisii TCP observate",
    "probe / fără pereche / min / mediană / p95 / max (ms)",
    "Potrivite / adăugate / lipsă / modificate / fără pereche / timpi indisponibili",
    "Timpi excluși",
    "IP-uri și porturi exacte, transport, etichete VLAN ordonate și un flux per tuplu",
    "Relativ la primul cadru cu marcaj temporal. Început inclus, sfârșit exclus",
    "Scanate / punct selectat / în domeniul de transport / în afara domeniului / fără timp / trunchiate / nerezolvate / pierderi raportate pe pachete",
    "Toleranță temporală",
    "Limită de scanare per captură",
    "Pierderi la interfață / în sistemul de operare",
    "Transporturi nerezolvate",
    "Conversații cu context nativ de flux comun",
  ],
  de: [
    "Vergleich gespeicherter Mitschnitte",
    "Referenz",
    "Kandidat",
    "TCP/UDP-Umfang",
    "Ergebnis",
    "Beobachtete Dauer",
    "Relatives Zeitfenster",
    "Abschnitt/Schnittstelle",
    "Zeitunsicherheit",
    "Diagnose",
    "Ausgelassene Zeilen",
    "Pakete / Bytes auf dem Medium",
    "Beobachtete TCP-Neuübertragungen",
    "Messungen / ungepaart / min / Median / p95 / max (ms)",
    "Zugeordnet / neu / fehlend / geändert / ungepaart / Zeitwerte fehlen",
    "Ausgeschlossene Zeitwerte",
    "Exakte IP-Adressen und Ports, Transport, geordnete VLAN-Tags und ein Stream pro Tupel",
    "Relativ zum ersten Paket mit Zeitstempel. Anfang inklusive, Ende exklusive",
    "Gelesen / Messpunkt / im Transportumfang / außerhalb / ohne Zeit / gekürzt / unaufgelöst / Paketverlustzähler",
    "Zeittoleranz",
    "Scanlimit pro Mitschnitt",
    "Verlustzähler für Schnittstelle / Betriebssystem",
    "Nicht aufgelöste Transportprotokolle",
    "Verbindungen mit gemeinsamem nativem Stream-Kontext",
  ],
  fr: [
    "Comparaison de captures enregistrées",
    "Référence",
    "Candidat",
    "Périmètre TCP/UDP",
    "Résultat",
    "Durée observée",
    "Fenêtre relative",
    "Section/interface",
    "Incertitude d’horloge",
    "Diagnostics",
    "Lignes omises",
    "Paquets / octets sur le réseau",
    "Retransmissions TCP observées",
    "mesures / sans paire / min / médiane / p95 / max (ms)",
    "Appariées / ajoutées / manquantes / modifiées / sans paire / mesures indisponibles",
    "Mesures exclues",
    "IP et ports exacts, transport, balises VLAN ordonnées et un flux par tuple",
    "Par rapport à la première trame horodatée. Début inclus, fin exclue",
    "Lues / point choisi / dans le périmètre de transport / hors périmètre / sans horodatage / tronquées / non résolues / pertes signalées par paquet",
    "Tolérance temporelle",
    "Limite d’analyse par capture",
    "Compteurs de pertes d’interface / du système d’exploitation",
    "Transports non résolus",
    "Conversations avec un contexte de flux natif partagé",
  ],
} as const;

function safeText(value: string) {
  return value.replace(/[\r\n]/g, " ").replaceAll("`", "'");
}

function refs(frames: Observation["frames"]) {
  return frames.map(({ frame, ref }) => `#${frame.number} [[${ref}]]`).join(", ");
}

function axis(value: number | string | null) {
  return value === null ? "—" : String(value);
}

/** Render precisely the same bounded evidence and references carried by the structured view. */
function comparisonReport(view: View) {
  const [
    title,
    baseline,
    candidate,
    scope,
    outcome,
    duration,
    window,
    point,
    clock,
    diagnostics,
    omitted,
    volume,
    retransmissions,
    timing,
    counts,
    withheld,
    matchRule,
    windowRule,
    coverage,
    tolerance,
    scanLimit,
    interfaceDrops,
    unresolvedTransports,
    sharedContext,
  ] = labels[view.reportLocale];
  const lines = [
    `# ${title}`,
    "",
    `- ${outcome} · \`${view.status}\``,
    `- ${scope} · ${view.transports.join(", ").toUpperCase()}. ${matchRule}.`,
    `- ${tolerance} · ${axis(view.timingToleranceUs)} µs`,
    `- ${scanLimit} · ${view.scanLimit}`,
    `- ${counts} · ${[
      view.totals.compared,
      view.totals.added,
      view.totals.missing,
      view.totals.changed,
      view.totals.unmatched,
      view.totals.timingUnavailable,
    ].join(" / ")}`,
    `- ${omitted} · ${view.omittedRows}`,
  ];
  const addDiagnostics = (values: View["diagnostics"]) => {
    if (values.length) lines.push(`- ${diagnostics} · ${values.map((value) => `\`${value}\``).join(", ")}`);
  };
  addDiagnostics(view.diagnostics);
  for (const [label, side] of [
    [baseline, view.baseline],
    [candidate, view.candidate],
  ] as const) {
    const c = side.coverage;
    lines.push(
      "",
      `## ${label}`,
      "",
      `- SHA-256 · \`${side.capture.sha256}\``,
      `- ${window} · [${side.window.startMs}, ${side.window.endMs}) ms. ${windowRule}.`,
      `- ${point} · ${axis(side.point.section)} / ${axis(side.point.interfaceId)}`,
      `- ${duration} · ${axis(c.observedDurationMs)} ms`,
      `- ${clock} · ${axis(side.timingUncertaintyUs)} µs`,
      `- ${coverage} · ${[
        c.scannedFrames,
        c.pointFrames,
        c.scopedTransportFrames,
        c.outOfScopeFrames,
        c.framesWithoutTimestamp,
        c.truncatedFrames,
        c.unresolvedFrames,
        c.knownDrops,
      ]
        .map(axis)
        .join(" / ")}`,
    );
    lines.push(
      `- ${interfaceDrops} · ${axis(c.interfaceDropCounters.interface)} / ${axis(c.interfaceDropCounters.operatingSystem)}`,
    );
    if (c.unresolvedTransports.length)
      lines.push(`- ${unresolvedTransports} · ${c.unresolvedTransports.join(", ").toUpperCase()}`);
    if (c.sharedNativeContexts) lines.push(`- ${sharedContext} · ${c.sharedNativeContexts}`);
    addDiagnostics(c.diagnostics);
    if (c.evidence.length) lines.push(`- ${refs(c.evidence)}`);
  }
  for (const row of view.rows) {
    const peers = row.endpoints.map(({ address, port }) => `\`${safeText(address)}\`:${port}`).join(" ↔ ");
    lines.push(
      "",
      `### ${row.transport.toUpperCase()} · ${peers}`,
      "",
      `- \`${row.kind}\`${row.metrics.length ? ` · ${row.metrics.join(", ")}` : ""}`,
    );
    if (row.vlans.length) lines.push(`- VLAN · ${row.vlans.join(" / ")}`);
    if (row.withheldTiming.length) lines.push(`- ${withheld} · ${row.withheldTiming.join(", ")}`);
    for (const [label, data] of [
      [baseline, row.baseline],
      [candidate, row.candidate],
    ] as const) {
      if (!data) continue;
      lines.push(
        `- ${label} · ${volume} · A→B ${data.aToB.packets}/${data.aToB.wireBytes}, B→A ${data.bToA.packets}/${data.bToA.wireBytes} · ${refs(data.frames)}`,
      );
      if (data.retransmissions !== null) {
        const frame = data.retransmissionFrame;
        lines.push(`  - ${retransmissions} · ${data.retransmissions}${frame ? ` · ${refs([frame])}` : ""}`);
      }
      for (const protocol of ["dns", "http"] as const) {
        const sample = data[protocol];
        if (!sample) continue;
        const numbers = [
          sample.samples,
          sample.unpaired,
          sample.minMs,
          sample.medianMs,
          sample.p95Ms,
          sample.maxMs,
        ];
        lines.push(
          `  - ${protocol.toUpperCase()} · ${timing} · ${numbers.map(axis).join(" / ")}${sample.frames.length ? ` · ${refs(sample.frames)}` : ""}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function fitComparisonReport(result: CaptureComparisonResult, limit: number) {
  while (true) {
    result.report = comparisonReport(result.comparison);
    if (JSON.stringify(result).length <= limit) return true;
    if (!result.comparison.rows.pop()) return false;
    result.comparison.omittedRows++;
  }
}

/** Collect only the representative frames actually published by this projection. */
export function comparisonEvidence(view: View) {
  return (["baseline", "candidate"] as const).map((side) => ({
    side,
    frames: [
      ...view[side].coverage.evidence,
      ...view.rows.flatMap((row) => {
        const observation = row[side];
        return observation
          ? [
              ...observation.frames,
              ...(observation.retransmissionFrame ? [observation.retransmissionFrame] : []),
              ...(observation.dns?.frames ?? []),
              ...(observation.http?.frames ?? []),
            ]
          : [];
      }),
    ],
  }));
}
