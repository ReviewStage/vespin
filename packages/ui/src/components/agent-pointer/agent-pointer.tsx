import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { useMotionHeld } from "../../use-motion-held.js";

/**
 * agent-pointer.tsx -- the agent's pointer over a picture of what it works in, a cloud Browser tab's live page or an app's window on the developer's Mac: an arrow drawn over the picture, never in it, gliding to each point the agent acts at.
 *
 * The owner says where the arrow's tip stands as a share of the box it is
 * drawn over, its positioned parent, so it lands on the same spot whatever
 * size the picture is drawn at, and glides there over `--ui-duration-fast`
 * on `--ui-spring-fast`. It is a compact rounded arrowhead in the brand's
 * amber with a white edge and a small shadow, so it reads over any picture,
 * an accent button included: the dark mode's brighter amber over a dark
 * ground, where the owner read the ground beneath it, else as the theme
 * draws. While it shows it sways gently about its tip, as the Mac's sways
 * while the agent thinks (`ComputerUse.swift`), a loop `--ui-loop-motion`
 * holds still; a press (`AGENT_POINTER_KIND.CLICK`) presses it once it has
 * arrived, with a ripple at the point, and typing bobs it over a glow of its
 * amber. Near the box's right or bottom edge it is mirrored about its tip,
 * so its body stays over the picture rather than clipped past it. Hidden,
 * it fades where it stands. Reduced motion holds it still: no sway, no bob,
 * no press, and a move jumps.
 *
 * It takes no pointer events and is hidden from a reader, since a point is
 * no content. Its sheet is `agent-pointer.css`.
 */

/** What the agent does where the pointer stands: moves there, presses there, or types there. */
export const AGENT_POINTER_KIND = { MOVE: "move", CLICK: "click", TYPE: "type" } as const;

export type AgentPointerKind = (typeof AGENT_POINTER_KIND)[keyof typeof AGENT_POINTER_KIND];

/** The ground beneath the pointer's tip, where its owner read it. */
export const AGENT_POINTER_GROUND = { LIGHT: "light", DARK: "dark" } as const;

export type AgentPointerGround = (typeof AGENT_POINTER_GROUND)[keyof typeof AGENT_POINTER_GROUND];

/**
 * The arrowhead's outline, a dart along the diagonal like a map's location
 * arrow: its tip at (1, 1), where the view box starts, the one sharp corner,
 * pointing up and to the left and opening 52 degrees, wide enough to read as a
 * pointer at a glance; its two wings rounded; and its tail, at the bottom
 * right, notched.
 */
const ARROW = "M1 1 13.07 5.16Q15.2 5.89 13.56 6.58L8.64 8.64 6.58 13.56Q5.89 15.2 5.16 13.07Z";

/** How far the arrow reaches from its tip, in CSS pixels: `--ui-space-16`, its drawn size. */
const ARROW_REACH = 16;

/** A share held to the box, 0 at its left or top edge and 1 at its right or bottom. */
function heldToBox(share: number): number {
  return Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
}

/** The size of the box the element fills, in CSS pixels, read again as it resizes. */
function useBoxSize(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = box.current;

    if (element === null) return;

    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };

    measure();

    // Note that a document with no resize observer, as a test's is, keeps the size first read.
    if (typeof ResizeObserver === "undefined") return;
    const heard = new ResizeObserver(measure);
    heard.observe(element);

    return () => heard.disconnect();
  }, []);

  return [box, size];
}

/** The agent's pointer over the box it is drawn in, its tip at `x` and `y` across it. */
export function AgentPointer({
  x,
  y,
  kind,
  move,
  shown,
  ground,
}: {
  /** Where its tip stands across the box, 0 at its left edge and 1 at its right. */
  x: number;
  /** Where its tip stands down the box, 0 at its top edge and 1 at its bottom. */
  y: number;
  kind: AgentPointerKind;
  /** The move it stands at, which keys a press, so each press presses afresh. */
  move: string | number;
  /** Whether it shows: an agent at work there; it fades where it stands once not. */
  shown: boolean;
  /** The ground beneath its tip, where the owner read it; as the theme draws where none. */
  ground?: AgentPointerGround | undefined;
}): React.JSX.Element {
  const still = useMotionHeld();
  const [box, size] = useBoxSize();
  const across = heldToBox(x);
  const down = heldToBox(y);
  // Mirrored about the tip where its body would reach past the box's edge.
  const flipX = size.width > 0 && (1 - across) * size.width < ARROW_REACH;
  const flipY = size.height > 0 && (1 - down) * size.height < ARROW_REACH;

  const style: CSSProperties = {
    "--ui-agent-pointer-x": String(across),
    "--ui-agent-pointer-y": String(down),
  };

  return (
    <div ref={box} className="ui-agent-pointer-box" aria-hidden="true">
      <div
        className="ui-agent-pointer"
        data-shown={shown ? "" : undefined}
        data-still={still ? "" : undefined}
        data-kind={kind}
        data-flip-x={flipX ? "" : undefined}
        data-flip-y={flipY ? "" : undefined}
        data-ground={ground}
        style={style}
      >
        <span className="ui-agent-pointer-halo" />
        <div className="ui-agent-pointer-sway">
          {/* Keyed by the move, so each press presses afresh. */}
          <svg key={move} className="ui-agent-pointer-arrow" viewBox="1 1 16 16" aria-hidden="true">
            <path d={ARROW} />
          </svg>
        </div>
        {kind === AGENT_POINTER_KIND.CLICK && shown && !still ? (
          <span key={move} className="ui-agent-pointer-ripple" />
        ) : null}
      </div>
    </div>
  );
}
