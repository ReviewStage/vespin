// integration-marks.ts -- the image each integration's mark is drawn from, by its provider: the desktop's own vector, which the app's config writes into its asset catalog.

import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@repo/features/integration-wire";

/**
 * The asset catalog's image for each provider's mark, under the
 * `IntegrationMarks` folder the app's config writes from
 * `assets/provider-marks/` (`@repo/ui`'s `scripts/native-provider-marks.ts`
 * renders them from `ProviderMark`, so they are the desktop's marks): a mark
 * in one ink a brand names per ground carries a dark appearance beside its
 * light one, and a mark in no named ink is a template, drawn in the ink of
 * the row it leads.
 */
export const INTEGRATION_MARK_ASSET = {
  [INTEGRATION_PROVIDER.EXECUTOR]: "IntegrationMarks/executor",
  [INTEGRATION_PROVIDER.GITHUB]: "IntegrationMarks/github",
  [INTEGRATION_PROVIDER.GMAIL]: "IntegrationMarks/gmail",
  [INTEGRATION_PROVIDER.GOOGLE_CALENDAR]: "IntegrationMarks/google-calendar",
  [INTEGRATION_PROVIDER.GOOGLE_DRIVE]: "IntegrationMarks/google-drive",
  [INTEGRATION_PROVIDER.GRANOLA]: "IntegrationMarks/granola",
  [INTEGRATION_PROVIDER.LINEAR]: "IntegrationMarks/linear",
  [INTEGRATION_PROVIDER.MERCURY]: "IntegrationMarks/mercury",
  [INTEGRATION_PROVIDER.NEON]: "IntegrationMarks/neon",
  [INTEGRATION_PROVIDER.NOTION]: "IntegrationMarks/notion",
  [INTEGRATION_PROVIDER.POSTHOG]: "IntegrationMarks/posthog",
  [INTEGRATION_PROVIDER.RESEND]: "IntegrationMarks/resend",
  [INTEGRATION_PROVIDER.SENTRY]: "IntegrationMarks/sentry",
  [INTEGRATION_PROVIDER.SLACK]: "IntegrationMarks/slack",
  [INTEGRATION_PROVIDER.STRIPE]: "IntegrationMarks/stripe",
  [INTEGRATION_PROVIDER.SUPABASE]: "IntegrationMarks/supabase",
  [INTEGRATION_PROVIDER.VERCEL]: "IntegrationMarks/vercel",
  [INTEGRATION_PROVIDER.YCOMBINATOR]: "IntegrationMarks/ycombinator",
} as const satisfies Record<IntegrationProvider, string>;

export type IntegrationMarkAsset = (typeof INTEGRATION_MARK_ASSET)[IntegrationProvider];
