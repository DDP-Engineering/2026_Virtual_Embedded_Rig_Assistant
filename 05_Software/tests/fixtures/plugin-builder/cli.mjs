// A CLI documented solely by --help. All operations are virtual and affect no hardware.
const [command] = process.argv.slice(2);
if (command === "--help") {
  console.log(
    "fixture-cli 1.0.0\nUsage: fixture-cli --help | inspect | burn\ninspect: print virtual device status\nburn: simulate a permanent write; fixture only",
  );
} else if (command === "inspect") {
  console.log("virtual device: ready");
} else if (command === "burn") {
  console.log("virtual burn complete; no hardware touched");
} else {
  console.error("Unknown operation. Use --help.");
  process.exitCode = 2;
}
