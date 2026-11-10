/**
 * banners.tsx -- a notice in each look: a strip across a column in the
 * attention tone, a card over a document in either tone, a card whose glyph
 * is a failure's bare mark, and a quiet row in
 * its place's frame; then each in a narrow column, where the presses drop
 * beneath the words; and a strip whose words its column cuts short, fading
 * out at their end; and the strip a maintainer signed in as a member reads,
 * for a member with a name and one without.
 */

import {
  AlertIcon,
  ArchiveIcon,
  BANNER_GLYPH,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  ConnectionLostNotice,
  GAP,
  PauseIcon,
  PlayIcon,
  STATUS_TONE,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  UsageLimitNotice,
  ViewingAsBanner,
} from "@repo/ui";
import { CONNECTION_LOST_PROVIDER, USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** Every look, at the width the column gives them. */
function Looks(): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      <Banner
        look={BANNER_LOOK.STRIP}
        tone={STATUS_TONE.ATTENTION}
        glyph={<AlertIcon />}
        actions={<Button variant={BUTTON_VARIANT.OUTLINE}>Move to Acme</Button>}
      >
        This task's repository, acme/relay, belongs to the Acme workspace.
      </Banner>
      <Banner
        look={BANNER_LOOK.CARD}
        glyph={<ArchiveIcon />}
        actions={<Button variant={BUTTON_VARIANT.PRIMARY}>Unarchive</Button>}
      >
        <Text variant={TEXT_VARIANT.SECTION}>This task is archived</Text>
      </Banner>
      <Banner look={BANNER_LOOK.CARD} tone={STATUS_TONE.ATTENTION} glyph={<AlertIcon />}>
        <Text variant={TEXT_VARIANT.SECTION}>Every new description starts from this template</Text>
        <Text tone={TEXT_TONE.MUTED}>
          Edit it to change what a description holds when it is made.
        </Text>
      </Banner>
      <Banner
        look={BANNER_LOOK.CARD}
        tone={STATUS_TONE.DANGER}
        glyph={<AlertIcon />}
        glyphLook={BANNER_GLYPH.MARK}
        actions={
          <>
            <Button variant={BUTTON_VARIANT.OUTLINE}>Move to cloud</Button>
            <Button variant={BUTTON_VARIANT.PRIMARY}>Retry</Button>
          </>
        }
      >
        <Text variant={TEXT_VARIANT.LABEL}>Studio can't reach acme/relay on GitHub.</Text>
        <Text tone={TEXT_TONE.MUTED}>Sign in on that Mac, then retry.</Text>
      </Banner>
      <div className="catalog-frame">
        <Banner
          look={BANNER_LOOK.ROW}
          glyph={<ArchiveIcon />}
          actions={
            <>
              <Button>Stop</Button>
              <Button variant={BUTTON_VARIANT.PRIMARY}>Unarchive</Button>
            </>
          }
        >
          <Text>This agent is archived</Text>
        </Banner>
      </div>
      <div className="catalog-frame">
        <Banner
          look={BANNER_LOOK.INSET}
          tone={STATUS_TONE.DANGER}
          glyph={<PauseIcon />}
          actions={<Button icon={<PlayIcon />}>Resume</Button>}
        >
          Queue paused: the next message could not be sent
        </Banner>
      </div>
    </Stack>
  );
}

function Banners(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="banner-looks" title="Looks and tones">
        <Looks />
      </CatalogSection>
      <CatalogSection id="banner-narrow" title="Narrow column">
        <div className="catalog-narrow">
          <Looks />
        </div>
      </CatalogSection>
      <CatalogSection id="banner-cut" title="A strip's words cut short">
        <div className="catalog-strip-room">
          <Banner
            look={BANNER_LOOK.STRIP}
            tone={STATUS_TONE.ATTENTION}
            glyph={<AlertIcon />}
            actions={<Button variant={BUTTON_VARIANT.OUTLINE}>Move to Acme</Button>}
          >
            This task's repository, acme/relay, belongs to the Acme workspace, which this account
            cannot push to.
          </Banner>
        </div>
      </CatalogSection>
      <CatalogSection id="banner-usage-limit" title="Usage limit">
        <Stack gap={GAP.FIELD}>
          <UsageLimitNotice
            notice={{ agent: USAGE_LIMIT_AGENT.CLAUDE, resetsAt: Date.UTC(2026, 10, 9, 23) }}
          />
          <UsageLimitNotice notice={{ agent: USAGE_LIMIT_AGENT.CODEX, resetsAt: null }} />
          <UsageLimitNotice
            notice={{
              agent: USAGE_LIMIT_AGENT.CLAUDE,
              resetsAt: null,
              moved: { from: "Work plan", to: "Personal plan" },
            }}
          />
          <UsageLimitNotice
            notice={{
              agent: USAGE_LIMIT_AGENT.CODEX,
              resetsAt: null,
              moved: { from: "dean@acme.dev", to: "API key · sk-…a91F" },
            }}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="banner-connection-lost" title="Connection lost">
        <Stack gap={GAP.FIELD}>
          <ConnectionLostNotice
            notice={{ provider: CONNECTION_LOST_PROVIDER.ANTHROPIC, restoredAt: null }}
          />
          <ConnectionLostNotice
            notice={{
              provider: CONNECTION_LOST_PROVIDER.OPENAI,
              restoredAt: Date.UTC(2026, 10, 9, 23, 40),
            }}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="banner-viewing-as" title="Viewing as a member">
        <Stack gap={GAP.FIELD}>
          <ViewingAsBanner
            member={{ name: "Ada Lovelace", email: "ada@example.com" }}
            stop={{
              run: () => undefined,
              busy: false,
              refusal: "The sign-in could not be stopped.",
              failed: false,
            }}
          />
          <ViewingAsBanner
            member={{ email: "ada@example.com" }}
            stop={{ run: () => undefined, busy: false, refusal: undefined, failed: false }}
          />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const BANNERS_EXAMPLE: Example = { id: "banners", title: "Banners", Render: Banners };
