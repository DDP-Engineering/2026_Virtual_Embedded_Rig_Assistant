# motor-drives

Starting-method comparison, starter or drive sizing and a logical connection scheme for the motors of VERA's
electrical project model, built on stored network and protection results and an industrial catalog.

- **The tool `motor_drives`** is VERA's own write tool, offered only while this plugin is loaded (never in read-only
  sessions). It reads `electrical-automation-model.json`, one CURRENT `protection_coordination` result and the
  `electrical_network` result it names (stale ones are refused), and one catalog in
  `electrical-automation-catalogs/`. It stores a new `electrical-automation-results/<run-id>/result.json` after
  approval, like a file write, with copies of the motors, circuits and cables it read, so a later model change marks
  it stale. It never changes the model and never configures or parameterises a drive, softstarter or relay.
- **Per motor and method** (direct-on-line, reversing, star-delta, softstarter, variable-speed drive): the process
  function (reversing, speed control, inching), star-delta eligibility (6 terminals, delta winding at the network
  voltage), the line starting current against the stated limit, the accelerating torque over the speed range and the
  acceleration time against the stated limit and the locked-rotor time, starts per hour; then a proposal - the
  simplest method that passes, conditional when a simpler one or the assembly is not established.
- **The model data**: motor `ratedPower`, `ratedVoltage`, `ratedCurrent`, `speed`, `frequency`,
  `startingCurrentRatio`, `startingTorqueRatio`, `pullUpTorqueRatio`, `breakdownTorqueRatio`, `inertia`,
  `loadInertia` (kg·m²), `loadTorque`, `breakawayTorque` (Nm), `lockedRotorTime`, `startsPerHour(Max)` (1/h),
  `terminals`, attributes `connection` (delta/star), `loadCharacteristic` (constant/linear/quadratic) and `duty`.
- **The assembly** for the proposal: contactors at their position current in the method's utilisation category
  (AC-3, AC-4 for inching, AC-1 for an external bypass), the mechanical-interlock accessory for reversing and
  star-delta, the overload relay setting and its cited tripping band against the start, a softstarter after cited
  derating, or a drive chosen by continuous and transient current per duty class; braking energy, EMC category, motor
  cable length and RCD types only from cited data. Protective-device and starter-coordination verdicts are copied
  from the protection result.
- **The scheme**: `assemblies` in the result list device tags, roles and order codes, power and control connections
  and mechanical, electrical and sequence interlocks, for a later ECAD adapter.
- **Skill**: `motor-starting`, the workflow from the protection result to a reviewed motor result.

Results are preliminary engineering support: no verified design, no conformity statement, no validated safety
function and no safety certification. The exact formats are the specifications REQ-DATA-79118f9a, REQ-DATA-a5673202,
REQ-DATA-d7e27def and REQ-DATA-06c0bd54 in VERA's `.agentic/specs/`.
