/**
 * prototype.tsx -- the prototype's page: its chrome (which design, the
 * agent's state, the frame, the theme) over the design drawn in a phone's
 * frame or a desktop's.
 *
 * A phone opening the page has no room for a phone drawn inside it, so
 * below a phone's width the phone frame is the screen itself and the frame
 * switch is put away.
 */

import {
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  GAP,
  IconButton,
  Inline,
  JUSTIFY,
  PROFILE,
  Stack,
  surfaceAttributes,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  THEME,
  TimeTicks,
  Tooltip,
} from "@repo/ui";
import { Moon, Sun } from "@repo/ui/icons";
import { useLayoutEffect, useState } from "react";
import { AGENT_STATE, AGENT_STATE_LABEL, AGENT_STATE_SHORT, type AgentState } from "./data";
import { DesignA } from "./design-a";
import { DesignB } from "./design-b";
import { DesignC } from "./design-c";
import { DesignD } from "./design-d";
import { FRAME, type Frame } from "./inbox-list";
import { APPROXIMATIONS } from "./parts";

const DESIGN = {
  A: "a",
  B: "b",
  C: "c",
  D: "d",
} as const;

type Design = (typeof DESIGN)[keyof typeof DESIGN];

const DESIGNS: Record<
  Design,
  { label: string; title: string; summary: string; Render: typeof DesignA }
> = {
  [DESIGN.A]: {
    label: "A · Ticket",
    title: "A · Thread as a ticket",
    summary:
      "The thread reads as a document: subject, agent status strip, comment cards, the ask as a block. The box replies on this thread and says it is also sent to the chat. No model picker.",
    Render: DesignA,
  },
  [DESIGN.B]: {
    label: "B · In agent",
    title: "B · Thread inside the agent",
    summary:
      "The agent is the frame: its head, model and ⋯ with Fork, over Chat · Threads. A row lands on Threads with the thread open; the composer is the agent's full one, labeled Reply on thread.",
    Render: DesignB,
  },
  [DESIGN.C]: {
    label: "C · Live peek",
    title: "C · Thread with a live peek",
    summary:
      "A's ticket, plus a fold showing what the agent is doing now, live while it works; on a phone a dock that rises as a sheet. Open full chat lands on its newest line.",
    Render: DesignC,
  },
  [DESIGN.D]: {
    label: "D · Card in chat",
    title: "D · Card in the chat",
    summary:
      "The earlier proposal: a row opens the chat narrowed to the thread's card and its replies. Show everything widens it to the whole chat at the card, to judge the jump.",
    Render: DesignD,
  },
};

const STATES: readonly AgentState[] = [
  AGENT_STATE.WORKING,
  AGENT_STATE.IDLE,
  AGENT_STATE.ARCHIVED,
  AGENT_STATE.WAITING,
];

/** Below this width the window is a phone's, and the phone frame is the screen. */
const PHONE_QUERY = "(max-width: 520px)";

/** The page's view, read from and written to the address so a link opens the same one. */
interface View {
  readonly design: Design;
  readonly state: AgentState;
  readonly frame: Frame;
  readonly dark: boolean;
}

function readView(): View {
  const params = new URLSearchParams(window.location.search);
  const design = Object.values(DESIGN).find((each) => each === params.get("design")) ?? DESIGN.A;
  const state = STATES.find((each) => each === params.get("state")) ?? AGENT_STATE.WORKING;
  const frame = params.get("frame") === FRAME.DESKTOP ? FRAME.DESKTOP : FRAME.PHONE;
  return { design, state, frame, dark: params.get("theme") !== THEME.LIGHT };
}

function writeView(view: View): void {
  const params = new URLSearchParams({
    design: view.design,
    state: view.state,
    frame: view.frame,
    theme: view.dark ? THEME.DARK : THEME.LIGHT,
  });
  window.history.replaceState(null, "", `?${params.toString()}`);
}

export function Prototype(): React.JSX.Element {
  const [view, setView] = useState<View>(readView);
  const [onPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  const frame = onPhone ? FRAME.PHONE : view.frame;
  const change = (next: Partial<View>) => {
    const changed = { ...view, ...next };
    writeView(changed);
    setView(changed);
  };
  // Note that the document carries the frame's profile and the theme, as an app's root does, so a menu portaled into the body is drawn at them too.
  useLayoutEffect(() => {
    const profile = frame === FRAME.PHONE ? PROFILE.WEB : PROFILE.DESKTOP;
    const theme = view.dark ? THEME.DARK : THEME.LIGHT;
    for (const [name, value] of Object.entries(surfaceAttributes(profile, theme))) {
      document.documentElement.setAttribute(name, value);
    }
  }, [frame, view.dark]);
  const themeToggle = (
    <Tooltip label={view.dark ? "Light theme" : "Dark theme"}>
      <IconButton
        label={view.dark ? "Light theme" : "Dark theme"}
        icon={view.dark ? <Sun /> : <Moon />}
        onClick={() => change({ dark: !view.dark })}
      />
    </Tooltip>
  );
  const design = DESIGNS[view.design];
  const Render = design.Render;
  return (
    <TimeTicks>
      <div className="inbox-proto-page" data-on-phone={onPhone ? "" : undefined}>
        <header className="inbox-proto-chrome">
          <Stack gap={GAP.CONTROL}>
            <Inline gap={GAP.CONTROL} justify={JUSTIFY.BETWEEN}>
              <ChoiceBar<Design>
                label="Design"
                look={CHOICE_BAR_LOOK.SEGMENTED}
                size={CHOICE_BAR_SIZE.COMPACT}
                items={Object.values(DESIGN).map((value) => ({
                  value,
                  label: DESIGNS[value].label,
                }))}
                value={view.design}
                onChange={(next) => change({ design: next })}
              />
              <Inline gap={GAP.TIGHT}>
                {onPhone ? null : (
                  <ChoiceBar<Frame>
                    label="Frame"
                    look={CHOICE_BAR_LOOK.SEGMENTED}
                    size={CHOICE_BAR_SIZE.COMPACT}
                    items={[
                      { value: FRAME.PHONE, label: "Phone" },
                      { value: FRAME.DESKTOP, label: "Desktop" },
                    ]}
                    value={view.frame}
                    onChange={(next) => change({ frame: next })}
                  />
                )}
                {onPhone ? null : themeToggle}
              </Inline>
            </Inline>
            <Inline gap={GAP.TIGHT} justify={JUSTIFY.BETWEEN} wrap={false}>
              <ChoiceBar<AgentState>
                label="Agent state"
                look={CHOICE_BAR_LOOK.FILL}
                size={CHOICE_BAR_SIZE.COMPACT}
                items={STATES.map((value) => ({
                  value,
                  label: onPhone ? AGENT_STATE_SHORT[value] : AGENT_STATE_LABEL[value],
                }))}
                value={view.state}
                onChange={(next) => change({ state: next })}
              />
              {onPhone ? themeToggle : null}
            </Inline>
            {onPhone ? null : (
              <Stack gap={GAP.NONE}>
                <Text variant={TEXT_VARIANT.LABEL}>{design.title}</Text>
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {design.summary}
                </Text>
              </Stack>
            )}
          </Stack>
        </header>
        <main className="inbox-proto-stage">
          <div className="inbox-proto-frame" data-frame={frame}>
            <Render key={`${view.design}-${frame}`} frame={frame} state={view.state} />
          </div>
        </main>
        {onPhone ? null : (
          <footer className="inbox-proto-note">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {`Prototype on synthetic data. Long-press (or right-click) any message for Fork; the agent's ⋯ has it too. ${APPROXIMATIONS}`}
            </Text>
          </footer>
        )}
      </div>
    </TimeTicks>
  );
}
