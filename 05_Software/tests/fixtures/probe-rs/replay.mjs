// Deterministic hardware stand-in, never a real probe-rs implementation or board acceptance.
// Started by the real NodeProcessHost so closed stdin, background output and tree stop are exercised.
const command = process.argv[2];
switch (command) {
  case "list":
    console.log("Fixture ST-Link: 0483:374b:FIXTURE");
    break;
  case "info":
    console.log("Fixture target STM32F401RETx (no hardware)");
    break;
  case "download":
    console.log("Fixture Downloaded ELF");
    break;
  case "verify":
    console.log("Fixture Verified ELF");
    break;
  case "reset":
    console.log("Fixture Reset");
    break;
  case "read":
    console.log("40000000: 12345678");
    break;
  case "attach":
  case "run":
    process.stdin.resume();
    process.stdin.on("end", () => {
      console.log("stdin:closed");
      setTimeout(() => console.log("Fixture RTT ready"), 30);
      setInterval(() => console.log("Fixture RTT tick"), 100);
    });
    break;
  default:
    console.error(`Unexpected fixture command ${command}`);
    process.exitCode = 2;
}
