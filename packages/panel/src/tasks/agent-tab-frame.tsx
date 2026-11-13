import { FILL_ELEMENT, Fill, joinRefs } from "@repo/ui";
import { createContext, type ReactNode, type Ref, useContext, useMemo, useState } from "react";

/**
 * agent-tab-frame.tsx -- an agent's tab's own boxes: the tab, filling its column, and its foot, where the composer docks under the transcript.
 *
 * Every agent's tab draws these, a started agent's, one still starting, a
 * draft's, a worker's, and so does the tab's skeleton while the agent is
 * read (`agent-tab-skeleton.tsx`), so the skeleton stands in the boxes the
 * tab lands in rather than in a copy of them. The transcript's words are
 * masked in the screen recording, and its pictures and code left out.
 *
 * The tab is also where what stands over the whole tab, the transcript's
 * rail among it, is drawn (`useAgentTabBox`), so it stands in the tab's
 * middle, composer and all, rather than the transcript's above it.
 */

/** The tab's own box, which what stands over the whole tab is drawn into; none before it is drawn, or outside a tab. */
const AgentTabBox = createContext<HTMLElement | null>(null);

/** The tab's own box, for what stands over the whole tab to be drawn into; none outside a tab. */
export function useAgentTabBox(): HTMLElement | null {
  return useContext(AgentTabBox);
}

/** The tab: a section taking its column's room, named `label` to a reader. */
export function AgentTabFrame({
  label,
  ref,
  children,
}: {
  label?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const [box, setBox] = useState<HTMLElement | null>(null);
  // Note that the caller's ref is kept beside the box's own, so both hold the section.
  const held = useMemo(() => joinRefs(ref, setBox), [ref]);

  return (
    <Fill as={FILL_ELEMENT.SECTION} ref={held} className="agent-tab relative" aria-label={label}>
      <AgentTabBox.Provider value={box}>{children}</AgentTabBox.Provider>
    </Fill>
  );
}

/** The tab's foot, under its transcript: what docks over the composer, and the composer. */
export function AgentTabFoot({ children }: { children: ReactNode }): React.JSX.Element {
  return <footer className="agent-tab-foot mt-auto flex-none">{children}</footer>;
}
