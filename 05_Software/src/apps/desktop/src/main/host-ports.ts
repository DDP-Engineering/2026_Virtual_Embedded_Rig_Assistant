import { setTimeout } from "node:timers/promises";
import type { Clock } from "@vera/core";

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: async (milliseconds) => {
    await setTimeout(milliseconds);
  },
};
