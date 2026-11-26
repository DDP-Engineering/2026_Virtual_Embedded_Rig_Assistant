# Startup test

Use DEMO-RIG revision B, unit DEMO-01, the fixture power supply, harness A and procedure BOOT-1 revision 2.
Connect the recorder, restart the preloaded firmware under the documented bench setup, and save the boot log.
Use the same setup for the baseline 1.0.0 control and candidate 1.1.0.
The boot criterion requires a READY event and no ERROR events during the complete boot capture.
For the separate I2C recovery observation, record the time from I2C_TIMEOUT to READY in milliseconds
using the two event timestamps. The test specification gives no acceptance limit for that measurement.
