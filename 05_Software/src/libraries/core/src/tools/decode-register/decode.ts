import type { DecodeRegisterArgs, DecodeRegisterDefinition, DecodeRegisterResult } from "@vera/shared";
import { DecodeFailure } from "./definition.js";

/** Pure exact arithmetic on a validated definition; no diagnosis is inferred from flags. */
export function decodeRegister(
  definition: DecodeRegisterDefinition,
  args: DecodeRegisterArgs,
  source: DecodeRegisterResult["source"],
): DecodeRegisterResult {
  if (
    args.device &&
    (args.device.id !== definition.device.id ||
      (args.device.revision !== undefined && args.device.revision !== definition.device.revision))
  )
    throw new DecodeFailure(
      "CONFLICT",
      "device_mismatch",
      "Use the device id and revision from the definition.",
    );
  const register = definition.registers.find((register) => register.name === args.register);
  if (!register)
    throw new DecodeFailure("INVALID", "unknown_register", "Choose a register declared in the definition.");
  const value = BigInt(args.value);
  const max = (1n << BigInt(register.widthBits)) - 1n;
  if (value > max)
    throw new DecodeFailure(
      "INVALID",
      "value_out_of_range",
      "Use an unsigned value that fits the register width.",
    );
  const hex = (value: bigint) => `0x${value.toString(16).padStart(register.widthBits / 4, "0")}`;
  let mapped = 0n;
  const fields = [...register.fields]
    .sort((a, b) => a.lsb - b.lsb)
    .map((field) => {
      const mask = (1n << BigInt(field.width)) - 1n;
      const extracted = (value >> BigInt(field.lsb)) & mask;
      mapped |= mask << BigInt(field.lsb);
      return {
        name: field.name,
        lsb: field.lsb,
        width: field.width,
        valueHex: hex(extracted),
        valueDec: extracted.toString(),
        label: field.enum?.find((entry) => BigInt(entry.value) === extracted)?.label ?? null,
        ref: source.ref,
      };
    });
  const unmapped = max ^ mapped;
  const result = {
    device: definition.device,
    register: register.name,
    widthBits: register.widthBits,
    ...(register.address === undefined ? {} : { address: register.address }),
    valueHex: hex(value),
    valueDec: value.toString(),
    fields,
    unmappedMaskHex: hex(unmapped),
    unmappedSetBitsHex: hex(value & unmapped),
    source,
    sourceRefs: register.sourceRefs ?? definition.sourceRefs,
  };
  // A successful decode is complete. Never let generic registry truncation discard fields or refs.
  if (JSON.stringify(result).length > 32000)
    throw new DecodeFailure(
      "INVALID",
      "result_too_large",
      "Shorten definition names, labels or source references so the complete result fits32000characters.",
    );
  return result;
}
