import { ContextCompactor } from "./compaction.js";

/**
 * Tests that size a history in bytes against a context window count the way a session does with provider
 * token counts off: one token per byte, with no cold or calibrated scale. They exercise compaction, limits
 * and budget arithmetic, not calibration, and stay exact whatever the cold ratio is.
 */
export function conservativeCompactor(): ContextCompactor {
  const compactor = new ContextCompactor();
  compactor.settings = { ...compactor.settings, calibrated: false };
  return compactor;
}

/** The same choice for a SessionService host: its `advanced` values with provider token counts off. */
export const conservativeCounting = {
  app: () => ({ providerTokenCounts: false }),
  workbench: () => ({}),
};
