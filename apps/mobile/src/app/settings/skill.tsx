// skill.tsx -- one installed skill's page under Settings' Skills, as the panel's Open shows it: its SKILL.md as written, and the files beside it, read once as the page opens.

import type { InstalledSkillContent } from "@repo/features/installed-skill-route-wire";
import { formatBytes } from "@repo/features/number-format";
import { fencedSkillFile, SKILLS_LINE } from "@repo/features/skills-settings-words";
import { VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EmptyState, MarkdownPage, Screen } from "@repo/ui-native";
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

/** The skill's file as written, then its files by path and size, as the panel's Open lists them. */
function skillWords(content: InstalledSkillContent): string {
  const files = content.files.map((file) => `- \`${file.path}\` · ${formatBytes(file.bytes)}`);

  return [fencedSkillFile(content.skillFile), `**${SKILLS_LINE.FILES}**`, ...files].join("\n\n");
}

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
      <Stack.Screen options={{ title: name }} />
      <Screen>
        {read.kind === SKILL_READ.READ ? (
          <MarkdownPage title={name} words={skillWords(read.content)} onOpenLink={openLink} />
        ) : read.kind === SKILL_READ.FAILED ? (
          <EmptyState
            title={SKILLS_LINE.VIEW_FAILED}
            symbol="exclamationmark.triangle"
            action={{
              label: VERB.RETRY,
              onPress: () => {
                setRead({ kind: SKILL_READ.READING });
                setRound((each) => each + 1);
              },
            }}
          />
        ) : (
          <EmptyState title={name} symbol="book.closed" loading />
        )}
      </Screen>
    </>
  );
}
