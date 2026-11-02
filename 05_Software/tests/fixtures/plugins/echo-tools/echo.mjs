// echo-tools fixture program: `serve` prints boot, then READY, and runs until stopped; any other
// command prints its arguments and working directory as JSON.
const [command, ...rest] = process.argv.slice(2);
if (command === "serve") {
  console.log("boot");
  setTimeout(() => console.log("READY"), 200);
  setInterval(() => {}, 1000);
} else console.log(JSON.stringify({ command, args: rest, cwd: process.cwd() }));
