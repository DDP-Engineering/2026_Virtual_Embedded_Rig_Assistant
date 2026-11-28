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
  case "chip":
    console.log("Fixture chip STM32F401RETx: NVM 0x08000000..0x08080000");
    break;
  case "download":
    console.log("Fixture Downloaded ELF");
    break;
  case "verify":
    // The real 0.32.0 line; a mismatch prints "Verification failed: contents do not match" and exits 0 too.
    console.log("Verification successful");
    break;
  case "profile":
    console.log("Samples 1000");
    console.log("                                         main_loop - 61.2%");
    console.log("                                          adc_read - 38.8%");
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
