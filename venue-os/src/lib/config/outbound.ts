export const OUTBOUND_MODES = [
  "enabled",
  "review_only",
  "disabled",
] as const;

export type OutboundMode = (typeof OUTBOUND_MODES)[number];
