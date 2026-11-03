import { describe, expect, it } from "vitest";
import { launcherArgs } from "./launcher.js";

describe("launcherArgs", () => {
  // REQ-FUNC-10e10004, REQ-SEC-10e10003
  it("renders the measured Bash and PowerShell EIM transports", () => {
    const command = ["idf.py", "spaced path", "", "tail\\", "two\\\\slashes"];
    expect(launcherArgs(["run"], command, "string", "win32")).toEqual([
      "run",
      '& "idf.py" "spaced path" "" "tail\\" "two\\\\slashes"',
    ]);
    expect(launcherArgs(["run"], command, "string", "linux")).toEqual([
      "run",
      '"idf.py" "spaced path" "" "tail\\\\" "two\\\\\\\\slashes"',
    ]);
  });
  it("places the launcher arguments before the command tokens in argv mode", () => {
    expect(launcherArgs(["run"], ["idf.py", "build"], "argv")).toEqual(["run", "idf.py", "build"]);
  });

  it("passes the command as one string of double-quoted tokens in string mode", () => {
    expect(launcherArgs(["run"], ["idf.py", "-p", "COM3", "flash"], "string")).toEqual([
      "run",
      '"idf.py" "-p" "COM3" "flash"',
    ]);
    expect(launcherArgs([], ["idf.py", ""], "string")).toEqual(['"idf.py" ""']);
  });

  it("doubles trailing backslashes so the closing quote stays a quote", () => {
    expect(launcherArgs(["run"], ["C:\\dir\\", "a\\b"], "string")).toEqual([
      "run",
      '"C:\\\\dir\\\\" "a\\\\b"',
    ]);
  });

  it.each(['"', "'", "&", "|", ";", "<", ">", "^", "%", "$", "`", "\0", "\n", "\r"])(
    "refuses a string-mode token containing %j with INVALID naming its index",
    (character) => {
      const command = ["idf.py", "build", `a${character}b`];
      let caught: unknown;
      try {
        launcherArgs(["run"], command, "string");
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "INVALID", params: { index: 2 } });
      expect(launcherArgs(["run"], command, "argv")).toEqual(["run", ...command]);
    },
  );
});
