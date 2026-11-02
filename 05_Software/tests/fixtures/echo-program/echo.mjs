// echo-program: a test program for the plugin process runner. ECHO_MODE selects the behaviour so the
// arguments stay free for argument-fidelity checks.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const mode = process.env.ECHO_MODE ?? "argv";
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const forever = () => setInterval(() => {}, 1000);

if (mode === "argv") {
  print({ args: process.argv.slice(2), cwd: process.cwd() });
} else if (mode === "env") {
  print(process.env);
} else if (mode === "stdin") {
  let bytes = 0;
  process.stdin.on("data", (chunk) => {
    bytes += chunk.length;
  });
  process.stdin.on("end", () => print({ bytes }));
  process.stdin.on("error", () => print({ bytes, error: true }));
} else if (mode === "flood") {
  const count = Number(process.env.ECHO_COUNT ?? "50000");
  process.stdout.write(`${"x".repeat(count - 3)}END`);
} else if (mode === "ansi") {
  process.stdout.write("\x1b[1;31mred\x1b[0m \x1b]0;title\x07plain\n");
  process.stderr.write("\x1b[33mwarn\x1b[0m\n");
} else if (mode === "orphan") {
  // Exits at once while a grandchild keeps the inherited stdout open for up to a minute.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (process.env.ECHO_PIDFILE) writeFileSync(process.env.ECHO_PIDFILE, String(child.pid));
  child.unref();
  print({ grandchild: child.pid });
} else if (mode === "grandchild") {
  // The grandchild inherits stdout, so the run only closes once the whole tree is gone.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (process.env.ECHO_PIDFILE) writeFileSync(process.env.ECHO_PIDFILE, String(child.pid));
  print({ grandchild: child.pid });
  forever();
}
