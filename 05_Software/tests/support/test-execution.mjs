/** Stateful filters and machine report files must be handled by a single Playwright invocation. */
export function needsSingleE2eRun(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      /^--(?:shard|last-failed|only-changed|ui|debug|test-list|test-list-invert|config)(?:=|$)/.test(arg) ||
      arg === "-c"
    )
      return true;
    if (arg === "--reporter" || arg.startsWith("--reporter=")) {
      const reporters = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
      if (!reporters || reporters.split(",").some((name) => !["list", "line", "dot"].includes(name)))
        return true;
    }
  }
  return false;
}

/** Build exact selection lists from the collector, retaining project and nested-suite identity. */
export function e2eLanes(report) {
  const browser = new Set(),
    serial = new Set();
  function visit(suites, parents = []) {
    for (const suite of suites) {
      const names = suite.line === 0 ? [] : [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        const lane = spec.tags.includes("parallel-browser") ? browser : serial;
        for (const test of spec.tests) {
          const title = [...names, spec.title].join(" › ");
          if (/[\r\n]/.test(title)) throw Error("Test-list titles must be one line");
          lane.add(`${test.projectName ? `[${test.projectName}] › ` : ""}${spec.file} › ${title}`);
        }
      }
      visit(suite.suites ?? [], names);
    }
  }
  visit(report.suites);
  return { browser: [...browser], serial: [...serial] };
}
