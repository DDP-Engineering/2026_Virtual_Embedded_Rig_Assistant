// Loaded with `node --import` before the CLI: reports the process's peak resident memory, worker
// threads included, on stderr when it exits.
process.on("exit", () => {
  process.stderr.write(`\nVERA_EVAL_MAXRSS_KB=${process.resourceUsage().maxRSS}\n`);
});
