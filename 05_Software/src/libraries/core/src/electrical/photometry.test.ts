// IES LM-63 and EULUMDAT reading (spec REQ-DATA-affb2e6b "Photometry"). Oracles are analytic: a Lambertian
// distribution I0 cos(g) emits pi I0 lumens, and the fictional panel I0 cos(g) (1 + 0.3 cos 2C) also emits pi I0
// (the cos 2C term integrates to zero). Tolerances are fixed here before the comparison: 0.5 % for integrated flux
// (1-degree C steps, 0.5-degree gamma zones over a bilinear interpolation of 5-degree data) and 0.01 % for values
// read straight from the file.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { intensityAt, parsePhotometry } from "./photometry.js";

const fixtures = new URL("../../../../../tests/fixtures/lighting-design/", import.meta.url);
const fixture = async (name: string) => (await readFile(new URL(name, fixtures))).toString("latin1");
const near = (actual: number, expected: number, share: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * share + 1e-9);
const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180);

/** An LM-63-2002 file: one row of candela per horizontal angle. */
function ies(options: {
  header?: string;
  tilt?: string;
  lamps?: number;
  lumens?: number;
  multiplier?: number;
  type?: number;
  units?: number;
  size?: [number, number, number];
  ballast?: number;
  factor?: number;
  watts?: number;
  vertical: number[];
  horizontal: number[];
  candela: (h: number, v: number) => number;
}): string {
  const [w, l, h] = options.size ?? [0.2, 0.2, 0.05];
  const lines = [
    ...(options.header === "" ? [] : [options.header ?? "IESNA:LM-63-2002"]),
    "[MANUFAC] Fictional",
    "[LUMINAIRE] Test",
    options.tilt ?? "TILT=NONE",
    `${options.lamps ?? 1} ${options.lumens ?? -1} ${options.multiplier ?? 1} ${options.vertical.length} ${options.horizontal.length} ${options.type ?? 1} ${options.units ?? 2} ${w} ${l} ${h}`,
    `${options.ballast ?? 1} ${options.factor ?? 1} ${options.watts ?? 30}`,
    options.vertical.join(" "),
    options.horizontal.join(" "),
    ...options.horizontal.map((hz) =>
      options.vertical.map((v) => options.candela(hz, v).toFixed(3)).join(" "),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
const lambert = (v: number) => (v <= 90 ? 1000 * cosd(v) : 0);
const gammas = Array.from({ length: 19 }, (_, i) => i * 5);

/** An EULUMDAT file with the given symmetry; `rel(C, g)` in cd/klm. */
function ldt(
  isym: number,
  rel: (c: number, g: number) => number,
  mc = 24,
  lampFlux = 1000,
  lamps = 1,
): string {
  const dc = 360 / mc;
  const cAngles = Array.from({ length: mc }, (_, i) => i * dc);
  const g = Array.from({ length: 37 }, (_, i) => i * 5);
  const stored =
    isym === 1
      ? [0]
      : isym === 2
        ? cAngles.filter((c) => c <= 180)
        : isym === 4
          ? cAngles.filter((c) => c <= 90)
          : isym === 3
            ? cAngles.filter((c) => c >= 90 && c <= 270)
            : cAngles;
  const lines = [
    "Fictional",
    "1",
    String(isym),
    String(mc),
    String(dc),
    "37",
    "5",
    "R1",
    "Test",
    "T1",
    "t.ldt",
    "2026-11-15",
    "600",
    "600",
    "40",
    "580",
    "580",
    "0",
    "0",
    "0",
    "0",
    "100",
    "100",
    "1",
    "0",
    "1",
    String(lamps),
    "LED",
    String(lampFlux),
    "4000",
    "80",
    "30",
    ...Array.from({ length: 10 }, () => "0.5"),
    ...cAngles.map(String),
    ...g.map(String),
    ...stored.flatMap((c) => g.map((v) => rel(c, v).toFixed(3))),
  ];
  return `${lines.join("\n")}\n`;
}
const relLambert = (_c: number, v: number) => (v <= 90 ? (1000 / Math.PI) * cosd(v) : 0);

describe("IES LM-63", () => {
  it("reads the fictional Lambertian downlight as absolute photometry with pi I0 lumens (REQ-FUNC-21405311)", async () => {
    const p = parsePhotometry("fict-downlight.ies", await fixture("fict-downlight.ies"));
    expect(p.format).toBe("ies");
    expect(p.standard).toBe("LM-63-2002");
    expect(p.symmetry).toBe("rotational");
    expect(p.absolute).toBe(true);
    expect(p.lampFlux).toBeNull();
    expect(p.inputWatts).toBe(30);
    expect(p.identity).toMatchObject({ catalogNumber: "FICT-D30" });
    near(p.luminaireFlux, Math.PI * 1000, 0.005);
    near(intensityAt(p, 0, 60), 500, 0.0001);
    near(intensityAt(p, 123, 60), 500, 0.0001);
    near(intensityAt(p, 0, 62.5), (cosd(60) + cosd(65)) * 500, 0.0001); // linear between stored angles
    expect(intensityAt(p, 0, 120)).toBe(0);
    expect(p.dimensions).toEqual({ width: 0.2, length: 0.2, height: 0.05 });
  });

  it("applies the multiplier, the ballast factor and the 1995 ballast-lamp factor (REQ-FUNC-21405311)", () => {
    const base = { vertical: gammas, horizontal: [0], candela: (_h: number, v: number) => lambert(v) };
    const scaled = parsePhotometry("a.ies", ies({ ...base, multiplier: 2, ballast: 0.9 }));
    near(intensityAt(scaled, 0, 0), 1800, 0.0001);
    const old = parsePhotometry("b.ies", ies({ ...base, header: "IESNA:LM-63-1995", factor: 0.95 }));
    expect(old.standard).toBe("LM-63-1995");
    near(intensityAt(old, 0, 0), 950, 0.0001);
    // 2002 and 2019 call the second number "future use": it is read as 1.
    near(intensityAt(parsePhotometry("c.ies", ies({ ...base, factor: 0.5 })), 0, 0), 1000, 0.0001);
    const plain = parsePhotometry("d.ies", ies({ ...base, header: "" }));
    expect(plain.standard).toBe("LM-63-1986");
  });

  it("converts feet to metres and gives relative photometry a lamp flux and light output ratio (REQ-FUNC-21405311)", () => {
    const p = parsePhotometry(
      "e.ies",
      ies({
        units: 1,
        size: [-2, 4, 0.5],
        lamps: 2,
        lumens: 2000,
        vertical: gammas,
        horizontal: [0],
        candela: (_h, v) => lambert(v),
      }),
    );
    expect(p.dimensions.width).toBeCloseTo(0.6096, 6);
    expect(p.dimensions.length).toBeCloseTo(1.2192, 6);
    expect(p.absolute).toBe(false);
    expect(p.lampFlux).toBe(4000);
    near(p.lightOutputRatio ?? 0, (Math.PI * 1000) / 4000, 0.005);
  });

  it("expands quadrant, bilateral and full horizontal symmetries (REQ-FUNC-21405311)", () => {
    const shape = (h: number, v: number) => lambert(v) * (1 + 0.3 * cosd(2 * h) + 0.1 * cosd(h));
    const make = (horizontal: number[]) =>
      parsePhotometry("s.ies", ies({ vertical: gammas, horizontal, candela: shape }));
    const quadrant = make([0, 15, 30, 45, 60, 75, 90]);
    expect(quadrant.symmetry).toBe("quadrant");
    for (const c of [150, 210, 330]) near(intensityAt(quadrant, c, 40), intensityAt(quadrant, 30, 40), 1e-9);
    const bilateral = make(Array.from({ length: 13 }, (_, i) => i * 15));
    expect(bilateral.symmetry).toBe("bilateral");
    near(intensityAt(bilateral, 300, 40), shape(60, 40), 0.0001);
    const full = make(Array.from({ length: 25 }, (_, i) => i * 15));
    expect(full.symmetry).toBe("full");
    near(intensityAt(full, 210, 40), shape(210, 40), 0.0001);
    near(intensityAt(full, -30, 40), shape(330, 40), 0.0001);
  });

  it("refuses files outside the validated domain with the reason (REQ-FUNC-21405311)", () => {
    const base = { vertical: gammas, horizontal: [0], candela: (_h: number, v: number) => lambert(v) };
    expect(() => parsePhotometry("t.ies", ies({ ...base, type: 2 }))).toThrow(/type B.*type C/);
    expect(() => parsePhotometry("t.ies", ies({ ...base, tilt: "TILT=INCLUDE" }))).toThrow(/TILT=INCLUDE/);
    expect(() => parsePhotometry("t.ies", ies({ ...base, horizontal: [90, 180, 270] }))).toThrow(
      /horizontal angles/,
    );
    expect(() => parsePhotometry("t.ies", ies({ ...base, units: 3 }))).toThrow(/units type/);
    const text = ies(base);
    expect(() => parsePhotometry("t.ies", text.slice(0, text.length - 40))).toThrow(/too few values/);
    expect(() => parsePhotometry("t.txt", text)).toThrow(/\.ies or \.ldt/);
    expect(() => parsePhotometry("t.ies", ies({ ...base, candela: () => 0 }))).toThrow(/no light/);
  });
});

describe("EULUMDAT", () => {
  it("reads the fictional Isym 4 panel in cd/klm scaled by the lamp flux (REQ-FUNC-21405311)", async () => {
    const p = parsePhotometry("fict-panel.ldt", await fixture("fict-panel.ldt"));
    expect(p.format).toBe("ldt");
    expect(p.symmetry).toBe("quadrant");
    expect(p.absolute).toBe(false);
    expect(p.lampFlux).toBe(4800);
    expect(p.inputWatts).toBe(36);
    expect(p.declaredLightOutputRatio).toBe(0.9);
    expect(p.dimensions).toEqual({ length: 0.597, width: 0.597, height: 0.04 });
    near(p.luminaireFlux, 4320, 0.005);
    const i0 = 900 / Math.PI;
    near(intensityAt(p, 15, 40), i0 * cosd(40) * (1 + 0.3 * cosd(30)) * 4.8, 0.0001);
    for (const c of [165, 195, 345]) near(intensityAt(p, c, 40), intensityAt(p, 15, 40), 1e-9);
    expect(intensityAt(p, 0, 135)).toBe(0);
  });

  it("expands Isym 0, 1 and 2, honours the conversion factor and reads CRLF files (REQ-FUNC-21405311)", () => {
    const shape = (c: number, v: number) => relLambert(c, v) * (1 + 0.2 * cosd(c));
    const rotational = parsePhotometry("r.ldt", ldt(1, relLambert));
    expect(rotational.symmetry).toBe("rotational");
    near(rotational.luminaireFlux, 1000, 0.005);
    const bilateral = parsePhotometry("b.ldt", ldt(2, shape));
    expect(bilateral.symmetry).toBe("bilateral");
    near(intensityAt(bilateral, 300, 40), shape(60, 40), 0.0001);
    const full = parsePhotometry("f.ldt", ldt(0, shape));
    expect(full.symmetry).toBe("full");
    near(intensityAt(full, 352.5, 40), (shape(345, 40) + shape(0, 40)) / 2, 0.0001);
    const converted = parsePhotometry(
      "c.ldt",
      ldt(1, relLambert).replace("\n100\n100\n1\n0\n", "\n100\n100\n2\n0\n"),
    );
    near(intensityAt(converted, 0, 0), 2 * intensityAt(rotational, 0, 0), 1e-9);
    const crlf = parsePhotometry("w.ldt", ldt(1, relLambert).replace(/\n/g, "\r\n"));
    expect(crlf.luminaireFlux).toBe(rotational.luminaireFlux);
  });

  it("ignores a UTF-8 byte order mark before the IES header (REQ-FUNC-21405311)", () => {
    const base = { vertical: gammas, horizontal: [0], candela: (_h: number, v: number) => lambert(v) };
    const latin1 = String.fromCharCode(0xef, 0xbb, 0xbf) + ies({ ...base, factor: 0.5 });
    const p = parsePhotometry("bom.ies", latin1);
    expect(p.standard).toBe("LM-63-2002");
    near(intensityAt(p, 0, 0), 1000, 0.0001);
  });

  it("treats a negative lamp count as absolute photometry (REQ-FUNC-21405311)", () => {
    const p = parsePhotometry("a.ldt", ldt(1, relLambert, 24, 3000, -1));
    expect(p.absolute).toBe(true);
    expect(p.lampFlux).toBeNull();
    near(p.luminaireFlux, 3000, 0.005);
  });

  it("refuses symmetry 3 and truncated files (REQ-FUNC-21405311)", () => {
    expect(() => parsePhotometry("s.ldt", ldt(3, relLambert))).toThrow(/symmetry 3/);
    const text = ldt(1, relLambert);
    expect(() => parsePhotometry("s.ldt", text.slice(0, text.length - 60))).toThrow(/too few values/);
    expect(() => parsePhotometry("s.ldt", "just one line\n")).toThrow(/too few lines/);
  });
});
