// integration-marks.ts -- the image each integration's mark is drawn from, by its provider: the desktop's own vector, which the app's config writes into its asset catalog.

import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@repo/features/integration-wire";
import { LINK_SITE, type LinkSite } from "@repo/features/link-site";

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

/**
 * The asset catalog's image for each well-known site's mark, which a link's
 * chip leads with as the panel's does, written beside the integrations'
 * (`@repo/ui`'s `scripts/native-provider-marks.ts` renders them from
 * `ProviderMark` too); a site that is an integration as well, Gmail, Google
 * Calendar and Google Drive, wears the integration's.
 */
export const LINK_SITE_MARK_ASSET = {
  [LINK_SITE.GOOGLE_MAPS]: "IntegrationMarks/google-maps",
  [LINK_SITE.GOOGLE_DOCS]: "IntegrationMarks/google-docs",
  [LINK_SITE.GOOGLE_SHEETS]: "IntegrationMarks/google-sheets",
  [LINK_SITE.GOOGLE_SLIDES]: "IntegrationMarks/google-slides",
  [LINK_SITE.GOOGLE_FORMS]: "IntegrationMarks/google-forms",
  [LINK_SITE.GOOGLE_DRIVE]: INTEGRATION_MARK_ASSET[INTEGRATION_PROVIDER.GOOGLE_DRIVE],
  [LINK_SITE.GOOGLE_CALENDAR]: INTEGRATION_MARK_ASSET[INTEGRATION_PROVIDER.GOOGLE_CALENDAR],
  [LINK_SITE.GOOGLE_MEET]: "IntegrationMarks/google-meet",
  [LINK_SITE.GMAIL]: INTEGRATION_MARK_ASSET[INTEGRATION_PROVIDER.GMAIL],
  [LINK_SITE.YOUTUBE]: "IntegrationMarks/youtube",
  [LINK_SITE.X]: "IntegrationMarks/x",
} as const satisfies Record<LinkSite, string>;

/**
 * The providers and sites whose mark is a template, drawn in no ink of its own (its
 * file draws in `currentColor` and names no dark one), which a React Native
 * image tints as SwiftUI's `foregroundStyle` does; every other mark keeps
 * its brand's own colors. Note that it must name what
 * `assets/provider-marks/` holds, which `@repo/ui`'s
 * `scripts/native-provider-marks.ts` writes.
 */
export const INTEGRATION_MARK_TEMPLATE: ReadonlySet<IntegrationProvider | LinkSite> = new Set([
  INTEGRATION_PROVIDER.GITHUB,
  INTEGRATION_PROVIDER.LINEAR,
  INTEGRATION_PROVIDER.VERCEL,
  LINK_SITE.X,
]);
