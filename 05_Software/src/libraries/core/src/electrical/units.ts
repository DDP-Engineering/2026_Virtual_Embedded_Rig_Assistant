// The one unit table of the electrical model (spec REQ-DATA-06c0bd54 "Units"). Spellings follow electronics-calc
// (Ω U+03A9, µ U+00B5, °C); each unit has exactly one spelling and no alias.

export const unitDimensions: Readonly<Record<string, readonly string[]>> = {
  voltage: ["V", "kV", "mV"],
  current: ["A", "kA", "mA"],
  power: ["W", "kW", "MW"],
  "apparent-power": ["VA", "kVA", "MVA"],
  "reactive-power": ["var", "kvar", "Mvar"],
  energy: ["J", "Wh", "kWh", "MWh"],
  frequency: ["Hz"],
  resistance: ["Ω", "mΩ", "kΩ"],
  capacitance: ["F", "mF", "µF"],
  inductance: ["H", "mH", "µH"],
  length: ["mm", "m", "km"],
  area: ["mm²"],
  time: ["ms", "s", "min", "h"],
  temperature: ["°C", "K"],
  ratio: ["1", "%"],
  speed: ["rpm"],
  torque: ["Nm"],
  "luminous-flux": ["lm"],
  illuminance: ["lx"],
  "luminous-efficacy": ["lm/W"],
};

/** Property names whose unit must belong to one dimension; any other name takes any unit of the table. */
export const knownProperties: Readonly<Record<string, string>> = {
  ratedVoltage: "voltage",
  voltage: "voltage",
  ratedCurrent: "current",
  current: "current",
  startingCurrent: "current",
  shortCircuitCurrent: "current",
  breakingCapacity: "current",
  ratedPower: "power",
  power: "power",
  apparentPower: "apparent-power",
  reactivePower: "reactive-power",
  powerFactor: "ratio",
  efficiency: "ratio",
  startingCurrentRatio: "ratio",
  voltageDrop: "ratio",
  phases: "ratio",
  poles: "ratio",
  demandFactor: "ratio",
  frequency: "frequency",
  speed: "speed",
  torque: "torque",
  length: "length",
  crossSection: "area",
  ambientTemperature: "temperature",
  luminousFlux: "luminous-flux",
  illuminance: "illuminance",
  luminousEfficacy: "luminous-efficacy",
  resistance: "resistance",
  impedance: "resistance",
  capacitance: "capacitance",
  inductance: "inductance",
  startTime: "time",
};

const dimensionOf = new Map(
  Object.entries(unitDimensions).flatMap(([dimension, units]) =>
    units.map((unit) => [unit, dimension] as const),
  ),
);

/** The dimension of a unit of the table, or undefined for any other text. */
export function unitDimension(unit: string): string | undefined {
  return dimensionOf.get(unit);
}

/** Why a unit does not fit: unknown, or of another dimension than the property's; undefined when it fits. */
export function unitProblem(unit: string, property?: string): string | undefined {
  const dimension = dimensionOf.get(unit);
  const wanted = property === undefined ? undefined : knownProperties[property];
  if (wanted !== undefined && dimension !== wanted)
    return `unit ${unit} is not a unit of ${wanted} (${unitDimensions[wanted]?.join(", ")})`;
  if (dimension === undefined) return `unit ${unit} is not in the electrical unit table`;
  return undefined;
}
