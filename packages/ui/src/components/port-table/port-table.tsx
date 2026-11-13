import type { ReactNode } from "react";
import { ReplayMask, ReplayUnmask } from "../../session-replay-marks.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * port-table.tsx -- a cloud agent's listening ports as a table: one line per port, its number first and what serves it under, and a column for each place it can reach, each cell its one action and the room for that action's stop.
 *
 * Every control a port has stands on its own line, and each place it can
 * reach keeps one column under one head (its glyph and its name, "This Mac"
 * or "Team link"), so a reader reads across for a port and down for who can
 * open it. The table lays out its columns from what they hold: the port's
 * column takes the room, and each place's column is its widest cell's own
 * width, so a cell's action hugs its words. A cell keeps the room for its
 * stop while there is nothing to stop, so the line never moves as a stop
 * comes and goes. With no port listed, a note says why in the table's place.
 *
 * The heads and the port numbers are the app's own words, which a screen
 * recording shows as they read; what serves a port is made from a command
 * line, which stays masked.
 */

/** One place a port can reach: its glyph and its name, heading its column. */
export interface PortTableColumn {
  readonly key: string;
  readonly icon: ReactNode;
  readonly label: string;
}

/** The ports as a table under the places' heads, or the note saying why none is listed. */
export function PortTable({
  label,
  portLabel,
  columns,
  empty,
  children,
}: {
  /** What the table is called, as a reader hears it. */
  label: string;
  /** What the ports' column is called, heard and never drawn, since each number says it. */
  portLabel: string;
  columns: readonly PortTableColumn[];
  /** Why no port is listed, drawn in the table's place; none while ports are. */
  empty?: string | undefined;
  /** The ports, each a `PortTableRow`. */
  children?: ReactNode;
}): React.JSX.Element {
  if (empty !== undefined) {
    return (
      <ReplayUnmask>
        <p className="ui-port-table-note">{empty}</p>
      </ReplayUnmask>
    );
  }

  return (
    <table className="ui-port-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col" className="ui-port-table-head">
            <VisuallyHidden>{portLabel}</VisuallyHidden>
          </th>
          {columns.map((column) => (
            <th key={column.key} scope="col" className="ui-port-table-head">
              <ReplayUnmask>
                <span className="ui-port-table-head-icon" aria-hidden="true">
                  {column.icon}
                </span>
                {column.label}
              </ReplayUnmask>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** One port: its number, what serves it under where that was read, then a cell per place, in the heads' order. */
export function PortTableRow({
  port,
  detail,
  children,
}: {
  port: number;
  /** What serves the port, such as `vite dev`; masked in a screen recording. */
  detail?: string | undefined;
  /** Its cells, each a `PortTableCell`. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <tr className="ui-port-table-row">
      <th scope="row" className="ui-port-table-port">
        <ReplayUnmask>
          <span className="ui-port-table-number">{port}</span>
        </ReplayUnmask>
        {detail === undefined ? null : (
          <ReplayMask>
            <span className="ui-port-table-detail">{detail}</span>
          </ReplayMask>
        )}
      </th>
      {children}
    </tr>
  );
}

/** One place's cell: its action, and beside it its stop where there is one, the room for it kept where there is none. */
export function PortTableCell({
  stop,
  children,
}: {
  /** What stops the place reaching the port, a compact IconButton; none while nothing reaches it. */
  stop?: ReactNode;
  /** The cell's action, a compact Button. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <td className="ui-port-table-cell">
      <ReplayUnmask>
        <span className="ui-port-table-act">
          {children}
          <span className="ui-port-table-stop">{stop}</span>
        </span>
      </ReplayUnmask>
    </td>
  );
}
