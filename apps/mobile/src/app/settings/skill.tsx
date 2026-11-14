// skill.tsx -- one installed skill's page under Settings' Skills, as the panel's Open shows it: its SKILL.md as written, and the files beside it, read once as the page opens.

import type { InstalledSkillContent } from "@repo/features/installed-skill-route-wire";
import { formatBytes } from "@repo/features/number-format";
import { readSkillFile } from "@repo/features/skill-file";
import { fencedSkillFile, SKILLS_LINE } from "@repo/features/skills-settings-words";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EmptyState, GLYPH, MarkdownPage, SCREEN_GROUND, Screen } from "@repo/ui-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useHostActs } from "../../host/host-provider.js";
import { useOpenLink } from "../../open-link.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** Where the read of the skill stands: out, answered, or not read. */
const SKILL_READ = {
  READING: "reading",
  READ: "read",
  FAILED: "failed",
} as const;

type SkillRead =
  | { readonly kind: typeof SKILL_READ.READING }
  | { readonly kind: typeof SKILL_READ.READ; readonly content: InstalledSkillContent }
  | { readonly kind: typeof SKILL_READ.FAILED };

/**
 * The skill's words, then its files by path and size, as the panel's Open
 * lists them. Note that the body under its frontmatter is drawn as the
 * Markdown it is, so it wraps to the phone's width, rather than as one block
 * of code a reader scrolls sideways through; a file with no frontmatter to
 * read stands as written.
 */
function skillWords(content: InstalledSkillContent): string {
  const files = content.files.map((file) => `- \`${file.path}\` · ${formatBytes(file.bytes)}`);
  const body = readSkillFile(content.skillFile)?.body.trim();
  const words = body === undefined ? fencedSkillFile(content.skillFile) : body;

  return [words, `**${SKILLS_LINE.FILES}**`, ...files].join("\n\n");
}

/** The bar's title over a skill's page: none, since the page's own heading names the skill. */
const NO_BAR_TITLE = "";

export default function SkillScreen() {
  const { skill = "", name = "" } = useLocalSearchParams<{ skill: string; name: string }>();
  const acts = useHostActs();
  const openLink = useOpenLink();
  const [read, setRead] = useState<SkillRead>({ kind: SKILL_READ.READING });
  const [round, setRound] = useState(0);

  // Note that a skill's files change only by a new install, so the page reads them once as it opens, and again only on Retry.
  useEffect(() => {
    let held = true;
    acts[ACT_KIND.INSTALLED_SKILLS_READ]({ skillId: skill })
      .then((answer) => {
        if (held)
          setRead(
            "failure" in answer
              ? { kind: SKILL_READ.FAILED }
              : { kind: SKILL_READ.READ, content: answer },
          );
      })
      .catch((cause: unknown) => {
        console.error("The skill was not read.", cause);

        if (held) setRead({ kind: SKILL_READ.FAILED });
      });

    return () => {
      held = false;
    };
  }, [acts, skill, round]);

  return (
    <>
      <Stack.Screen options={{ title: NO_BAR_TITLE }} />
      <Screen ground={SCREEN_GROUND.GROUPED}>
        {read.kind === SKILL_READ.READ ? (
          <MarkdownPage title={name} words={skillWords(read.content)} onOpenLink={openLink} />
        ) : read.kind === SKILL_READ.FAILED ? (
          <EmptyState
            title={SKILLS_LINE.VIEW_FAILED}
            symbol={GLYPH.FAILED}
            retry={() => {
              setRead({ kind: SKILL_READ.READING });
              setRound((each) => each + 1);
            }}
          />
        ) : (
          <EmptyState title={readingWords(name)} symbol={GLYPH.SKILL} loading />
        )}
      </Screen>
    </>
  );
}
