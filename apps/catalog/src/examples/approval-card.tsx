import {
  APPROVAL_CARD_ANSWER,
  APPROVAL_OUTCOME,
  ApprovalCard,
  type ApprovalCardAnswer,
  type ApprovalSettled,
  GAP,
  Stack,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * approval-card.tsx -- a tool call an agent holds for an answer: a command
 * that settles as it is answered, a long one cut to a few lines with Show
 * all, one a subagent asks, a press still out, and the settled lines.
 */

const LONG_COMMAND = [
  "cd ~/code/app && pnpm install --frozen-lockfile",
  "pnpm exec vitest run packages/host/src/compose-mac-commands.test.ts --reporter=verbose",
  "git log --oneline -20 && git status --short && pnpm exec tsc --noEmit",
  'for pkg in packages/*; do echo "$pkg"; (cd "$pkg" && pnpm run typecheck); done',
  "rm -rf node_modules/.cache && pnpm build",
  "git add -A && git commit -m 'chore: rebuild'",
  "git push origin HEAD",
].join(" && \\\n  ");

/** The line each answer settles the card into. */
const SETTLED_BY: Record<ApprovalCardAnswer, ApprovalSettled> = {
  [APPROVAL_CARD_ANSWER.ALLOW]: { outcome: APPROVAL_OUTCOME.ALLOWED, words: "Allowed" },
  [APPROVAL_CARD_ANSWER.ALLOW_FOR_AGENT]: {
    outcome: APPROVAL_OUTCOME.ALLOWED,
    words: "Allowed for this agent",
  },
  [APPROVAL_CARD_ANSWER.DENY]: { outcome: APPROVAL_OUTCOME.DENIED, words: "Denied by you" },
};

/** A card that settles into its line as it is answered. */
function Answerable(props: {
  title: string;
  description?: string;
  asker?: string;
  label: string;
  text: string;
}): React.JSX.Element {
  const [settled, setSettled] = useState<ApprovalSettled | undefined>(undefined);
  return (
    <ApprovalCard
      title={props.title}
      description={props.description}
      asker={props.asker}
      detail={{ label: props.label, text: props.text }}
      settled={settled}
      onAnswer={(answer) => setSettled(SETTLED_BY[answer])}
    />
  );
}

function ApprovalCards(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="approval-card-waiting" title="Waiting on an answer">
        <Stack gap={GAP.BLOCK}>
          <Answerable
            title="Claude wants to run a command"
            description="Remove the build folder"
            label="Command"
            text="rm -rf dist"
          />
          <Answerable
            title="Claude wants to edit a file"
            asker="Asked by subagent Explore"
            label="packages/ui/src/index.ts"
            text={'export * from "./components/approval-card/approval-card.js";'}
          />
          <Answerable title="Claude wants to run a command" label="Command" text={LONG_COMMAND} />
        </Stack>
      </CatalogSection>
      <CatalogSection id="approval-card-answering" title="An answer out">
        <ApprovalCard
          title="Claude wants to run a command"
          detail={{ label: "Command", text: "pnpm test" }}
          answering={APPROVAL_CARD_ANSWER.ALLOW}
          onAnswer={() => undefined}
        />
      </CatalogSection>
      <CatalogSection id="approval-card-settled" title="Settled">
        <Stack gap={GAP.TIGHT}>
          <ApprovalCard
            title="Claude wants to run a command"
            settled={{ outcome: APPROVAL_OUTCOME.ALLOWED, words: "Allowed" }}
            onAnswer={() => undefined}
          />
          <ApprovalCard
            title="Claude wants to run a command"
            settled={{ outcome: APPROVAL_OUTCOME.DENIED, words: "Denied by you" }}
            onAnswer={() => undefined}
          />
          <ApprovalCard
            title="Claude wants to run a command"
            settled={{ outcome: APPROVAL_OUTCOME.EXPIRED, words: "Expired" }}
            onAnswer={() => undefined}
          />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const APPROVAL_CARD_EXAMPLE: Example = {
  id: "approval-card",
  title: "Approval card",
  Render: ApprovalCards,
};
