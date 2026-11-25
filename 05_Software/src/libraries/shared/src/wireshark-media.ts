import { z } from "zod";

export const mediaProfileSchema = z.enum(["wifi", "ble", "usb", "voip"]);
export type MediaProfile = z.infer<typeof mediaProfileSchema>;

export const mediaFields = {
  wifi: [
    "wlan.fc.type",
    "wlan.fc.subtype",
    "wlan.fc.protected",
    "radiotap.channel.freq",
    "radiotap.dbm_antsignal",
  ],
  ble: ["btle.advertising_header.pdu_type", "bthci_evt.le_meta_subevent", "btatt.opcode", "btatt.handle"],
  usb: [
    "usb.transfer_type",
    "usb.endpoint_address",
    "usb.irp_info.direction",
    "usb.urb_status",
    "usb.usbd_status",
    "usb.setup.bRequest",
  ],
  voip: ["sip.Status-Code", "rtp.seq", "rtp.p_type", "rtp.marker"],
} as const satisfies Record<MediaProfile, readonly string[]>;

export const mediaProtocols = z.enum([
  "wlan",
  "btle",
  "bthci_evt",
  "btatt",
  "usb",
  "sip",
  "sdp",
  "rtp",
  "rtcp",
]);
export const mediaFieldValues = 4;
export const mediaResultLimit = 12;
export const mediaStreamLimit = 6;
const count = z.number().int().nonnegative();
const frame = count.min(1);
const field = z.enum(Object.values(mediaFields).flat());
const value = z
  .string()
  .max(16)
  .regex(/^(?:-?\d{1,10}|0x[0-9a-f]{1,8}|True|False)$/i);

export const mediaProjectionSchema = z.strictObject({
  profile: mediaProfileSchema,
  observedProtocols: z.partialRecord(mediaProtocols, count),
  packetsOmitted: count,
  truncatedFrames: count,
  fieldValuesLimitedFrames: count,
  rows: z
    .array(
      z.strictObject({
        frame,
        protocols: z.array(mediaProtocols).min(1).max(mediaProtocols.options.length),
        fields: z.partialRecord(field, z.array(value).min(1).max(mediaFieldValues)),
        truncated: z.boolean(),
        fieldValuesLimited: z.boolean(),
      }),
    )
    .max(mediaResultLimit),
  rtp: z
    .strictObject({
      scope: z.enum(["whole_capture", "partial_observation"]),
      unresolvedFrames: count,
      streamsOmitted: count,
      streams: z
        .array(
          z.strictObject({
            frame,
            packets: count.min(1),
            missingSequenceNumbers: count.nullable(),
            maxDeltaMs: z.number().nonnegative().nullable(),
            jitterMs: z.number().nonnegative().nullable(),
            jitterClock: z.literal("assumed_rtp_avp_8khz").nullable(),
            limitations: z
              .array(
                z.enum([
                  "scope_limited",
                  "sequence_discontinuity",
                  "arrival_time_unavailable",
                  "clock_rate_unavailable",
                  "too_few_packets",
                ]),
              )
              .max(5),
          }),
        )
        .max(mediaStreamLimit),
    })
    .nullable(),
});
