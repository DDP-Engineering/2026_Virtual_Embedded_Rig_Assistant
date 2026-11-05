import { describe, expect, it } from "vitest";
import type { PluginRisk } from "./plugins.js";
import {
  classifyCommand,
  confirmationMatches,
  type ProgramPolicy,
  type ProgramRule,
  programArgumentRefusal,
  programCommandLine,
  programPolicy,
} from "./program-rules.js";
import type { PermissionMode } from "./session.js";

const esptool: ProgramRule[] = [
  { match: "esptool version", risk: "safe" },
  { match: "esptool * {merge-bin,image-info,elf2image} *", risk: "safe" },
  { match: "esptool * {chip-id,read-mac} *", risk: "device-read", note: "Resets the chip." },
  { match: "esptool * {write-flash,erase-flash} *", risk: "device-write", note: "Overwrites firmware." },
];
const risk = (rules: ProgramRule[], line: string) => {
  const [program = "", ...args] = line.split(" ");
  return classifyCommand(rules, program, args).risk;
};

describe("token normalisation (REQ-FUNC-5bb9429f)", () => {
  it.each([
    "esptool --chip esp32 write_flash 0x0 a.bin",
    "esptool --chip esp32 write-flash 0x0 a.bin",
    "esptool WRITE-FLASH",
    "ESPTOOL Write_Flash",
  ])("both spellings and any case: %s", (line) => {
    expect(risk(esptool, line)).toBe("device-write");
  });
  it("normalises pattern tokens too", () => {
    expect(risk([{ match: "esptool * Write_Flash *", risk: "safe" }], "esptool write-flash")).toBe("safe");
  });
  it("--driver=x and --driver x match the same rule", () => {
    const rules: ProgramRule[] = [{ match: "tool * --driver x *", risk: "safe" }];
    expect(risk(rules, "tool --driver=X")).toBe("safe");
    expect(risk(rules, "tool --driver x")).toBe("safe");
    expect(risk(rules, "tool a --driver=x b")).toBe("safe");
    expect(risk(rules, "tool --driver=y")).toBe("device-write");
    expect(risk([{ match: "tool --driver=x", risk: "safe" }], "tool --driver x")).toBe("safe");
  });
  it("leaves a single-dash -d=x as one token and keeps empty values", () => {
    expect(risk([{ match: "tool -d x", risk: "safe" }], "tool -d=x")).toBe("device-write");
    expect(risk([{ match: "tool -d=x", risk: "safe" }], "tool -d=x")).toBe("safe");
    expect(classifyCommand([{ match: "tool --out *", risk: "safe" }], "tool", ["--out="]).risk).toBe("safe");
  });
});

describe("pattern grammar (REQ-FUNC-80b2033a)", () => {
  it.each([
    ["esptool version", "esptool version", true],
    ["esptool version", "esptool version --x", false],
    ["esptool * chip-id *", "esptool chip-id", true],
    ["esptool * chip-id *", "esptool --port COM3 chip-id --x", true],
    ["espefuse * burn-*", "espefuse burn-key", true],
    ["espefuse * burn-*", "espefuse burn-key k", false],
    ["espefuse * burn-* *", "espefuse burn-key k", true],
    ["espefuse * burn-*", "espefuse burn", false],
    ["esptool {merge-bin,image-info}", "esptool image-info", true],
    ["esptool {merge-bin,image-info}", "esptool merge", false],
    ["esptool {burn-*,erase} *", "esptool burn-block-data x", true],
    ["esptool {a,}", "esptool {a,}", true],
    ["esptool {a,b", "esptool {a,b", true],
    ["esptool  *   version", "esptool version", true],
    ["other version", "esptool version", false],
  ])("%s ~ %s -> %s", (match, line, matches) => {
    expect(risk([{ match, risk: "safe" }], line)).toBe(matches ? "safe" : "device-write");
  });
});

describe("matching cost (REQ-FUNC-80b2033a)", () => {
  it.each(
    [[], ["burn-key"], ["before", "burn-key", "after"], ["erase", "--port=COM3"]].map((args) => [args]),
  )(
    "preserves risk, notes, timeout and the first irreversible word across adjacent wildcards: %j",
    (args) => {
      const classify = (match: string) =>
        classifyCommand([{ match, risk: "irreversible", note: "Permanent", timeout: 7 }], "tool", args);
      expect(classify("tool * * {burn-*,erase} * *")).toEqual(classify("tool * {burn-*,erase} *"));
      expect(classify("tool * * *")).toEqual(classify("tool *"));
    },
  );
  it("stays linear in pattern tokens times command tokens for wildcard-heavy rules", () => {
    const match = `tool ${"* ".repeat(510)}never`;
    const rules: ProgramRule[] = Array.from({ length: 50 }, () => ({ match, risk: "safe" }));
    const args = Array.from({ length: 64 }, (_, i) => `--a${i}=b`);
    const started = Date.now();
    expect(classifyCommand(rules, "tool", args).risk).toBe("device-write");
    expect(Date.now() - started).toBeLessThan(300);
  });
});

describe("highest risk wins (REQ-FUNC-2819a97e)", () => {
  const idf: ProgramRule[] = [
    { match: "idf.py * build *", risk: "safe", note: "A" },
    { match: "idf.py * flash *", risk: "device-write", note: "B" },
    { match: "idf.py * monitor *", risk: "blocked", note: "C" },
  ];
  it("takes the most dangerous of several subcommands with every note", () => {
    expect(classifyCommand(idf, "idf.py", ["build", "flash"])).toEqual({
      risk: "device-write",
      notes: ["A", "B"],
      confirm: null,
      timeout: null,
    });
    expect(classifyCommand(idf, "idf.py", ["build", "flash", "monitor"]).risk).toBe("blocked");
  });
  it.each<[PluginRisk, PluginRisk, PluginRisk]>([
    ["safe", "device-read", "device-read"],
    ["device-write", "device-read", "device-write"],
    ["irreversible", "device-write", "irreversible"],
    ["irreversible", "blocked", "blocked"],
  ])("%s and %s -> %s", (a, b, expected) => {
    expect(
      risk(
        [
          { match: "tool *", risk: a },
          { match: "tool x", risk: b },
        ],
        "tool x",
      ),
    ).toBe(expected);
  });
  it("lists a repeated note once, in manifest order", () => {
    const notes = classifyCommand(
      [
        { match: "tool x", risk: "safe", note: "Same." },
        { match: "tool *", risk: "safe", note: "Other." },
        { match: "tool {x,y}", risk: "safe", note: "Same." },
      ],
      "tool",
      ["x"],
    ).notes;
    expect(notes).toEqual(["Same.", "Other."]);
  });
});

describe("unmatched (REQ-FUNC-9ca99463)", () => {
  it("is device-write without notes", () => {
    expect(classifyCommand(esptool, "esptool", ["frobnicate"])).toEqual({
      risk: "device-write",
      notes: [],
      confirm: null,
      timeout: null,
    });
    expect(classifyCommand([], "esptool", ["version"]).risk).toBe("device-write");
  });
});

describe("rule timeout (REQ-FUNC-90a95bef)", () => {
  it("is the largest timeout of the matching rules, else null", () => {
    const rules: ProgramRule[] = [
      { match: "idf.py * build *", risk: "safe", timeout: 600 },
      { match: "idf.py * flash *", risk: "device-write", timeout: 120 },
      { match: "idf.py *", risk: "safe" },
    ];
    expect(classifyCommand(rules, "idf.py", ["build", "flash"]).timeout).toBe(600);
    expect(classifyCommand(rules, "idf.py", ["flash"]).timeout).toBe(120);
    expect(classifyCommand(rules, "idf.py", ["size"]).timeout).toBeNull();
    expect(classifyCommand([], "idf.py", ["build"]).timeout).toBeNull();
  });
});

describe("confirmation word (REQ-SEC-e8695b28)", () => {
  it("is the token the first non-wildcard pattern token after the program matched", () => {
    const rules: ProgramRule[] = [{ match: "espefuse * burn-key *", risk: "irreversible" }];
    expect(classifyCommand(rules, "espefuse", ["--port", "COM3", "burn_key", "BLOCK_KEY0"]).confirm).toBe(
      "burn-key",
    );
    expect(
      classifyCommand([{ match: "espefuse * {burn-efuse,burn-key} *", risk: "irreversible" }], "espefuse", [
        "burn-efuse",
        "X",
      ]).confirm,
    ).toBe("burn-efuse");
    expect(
      classifyCommand([{ match: "espefuse * burn-*", risk: "irreversible" }], "espefuse", ["BURN_BIT"])
        .confirm,
    ).toBe("burn-bit");
  });
  it("is the program name when the pattern names nothing after it", () => {
    expect(classifyCommand([{ match: "Danger *", risk: "irreversible" }], "danger", ["x"]).confirm).toBe(
      "danger",
    );
  });
  it("comes from the first matching irreversible rule, and only for irreversible commands", () => {
    const rules: ProgramRule[] = [
      { match: "tool * write *", risk: "device-write" },
      { match: "tool * lock *", risk: "irreversible" },
      { match: "tool * write *", risk: "irreversible" },
    ];
    expect(classifyCommand(rules, "tool", ["write", "lock"]).confirm).toBe("lock");
    expect(classifyCommand(rules.slice(0, 1), "tool", ["write"]).confirm).toBeNull();
    expect(classifyCommand([{ match: "tool *", risk: "blocked" }], "tool", []).confirm).toBeNull();
  });
  it("compares trimmed, normalised typed text", () => {
    expect(confirmationMatches("burn-key", " BURN_KEY ")).toBe(true);
    expect(confirmationMatches("burn-key", "burn-key")).toBe(true);
    expect(confirmationMatches("burn-key", "burn")).toBe(false);
    expect(confirmationMatches("burn-key", "")).toBe(false);
    expect(confirmationMatches("burn-key", undefined)).toBe(false);
    expect(confirmationMatches(null, "burn-key")).toBe(false);
  });
});

describe("pre-rule refusals (REQ-SEC-28b53f44)", () => {
  it.each([
    [["@args.txt"], { reason: "argument-file", index: 0 }],
    [["ok", "a\nb"], { reason: "control", index: 1 }],
    [["a\rb"], { reason: "control", index: 0 }],
    [["a\0b"], { reason: "control", index: 0 }],
    [Array.from({ length: 65 }, () => "x"), { reason: "count" }],
    [["x".repeat(4097)], { reason: "length", index: 0 }],
  ])("%j is refused", (args, refusal) => {
    expect(programArgumentRefusal(args)).toEqual(refusal);
  });
  it("accepts the limits and an inner @", () => {
    expect(programArgumentRefusal(Array.from({ length: 64 }, () => "x".repeat(4096)))).toBeNull();
    expect(programArgumentRefusal(["x@y", "", "--a=@b"])).toBeNull();
  });
});

describe("mode matrix (REQ-FUNC-8d305364, REQ-SEC-94998c85, REQ-SEC-2b4bcdf5)", () => {
  const modes: PermissionMode[] = ["read-only", "ask", "auto-edit", "bypass"];
  const risks: PluginRisk[] = ["safe", "device-read", "device-write", "irreversible", "blocked"];
  const table: Record<PermissionMode, ProgramPolicy[]> = {
    "read-only": ["run", "refuse", "refuse", "refuse", "refuse"],
    ask: ["run", "user", "user", "confirm", "refuse"],
    "auto-edit": ["run", "mode", "user", "confirm", "refuse"],
    bypass: ["run", "mode", "mode", "mode", "refuse"],
  };
  const trial: Record<PermissionMode, ProgramPolicy[]> = {
    "read-only": ["refuse", "refuse", "refuse", "refuse", "refuse"],
    ask: ["user", "user", "user", "confirm", "refuse"],
    "auto-edit": ["user", "user", "user", "confirm", "refuse"],
    bypass: ["user", "user", "user", "confirm", "refuse"],
  };
  for (const mode of modes)
    for (const [index, level] of risks.entries()) {
      it(`${mode} ${level} -> ${table[mode][index]}`, () => {
        expect(programPolicy(mode, level, false)).toBe(table[mode][index]);
      });
      it(`trial ${mode} ${level} -> ${trial[mode][index]}`, () => {
        expect(programPolicy(mode, level, true)).toBe(trial[mode][index]);
      });
    }
});

describe("programCommandLine", () => {
  it("quotes arguments a reader could not split back", () => {
    expect(programCommandLine("esptool", ["--port", "COM3", "write-flash", "my app.bin", "", 'a"b'])).toBe(
      'esptool --port COM3 write-flash "my app.bin" "" "a\\"b"',
    );
  });
});
