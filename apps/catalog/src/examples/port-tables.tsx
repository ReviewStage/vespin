import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  IconButton,
  PortTable,
  PortTableCell,
  PortTableRow,
  STATUS_TONE,
  StatusGlyph,
} from "@repo/ui";
import { ArrowUpRight, GLYPH, LaptopIcon, LinkIcon } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * port-tables.tsx -- a cloud agent's ports as a table: each line a port with
 * Open under This Mac and Share under Team link, a press turning its place
 * on, the glyph lit and a stop beside it; one action busy; one place alone,
 * as a host that forwards nothing draws it; and the note where no port is.
 */

const PORTS = [
  { port: 5173, detail: "vite dev" },
  { port: 3001, detail: "email preview" },
] as const;

const COLUMNS = [
  { key: "mac", icon: <LaptopIcon />, label: "This Mac" },
  { key: "team", icon: <LinkIcon />, label: "Team link" },
] as const;

/** A cell's action, its glyph lit while its place is on, busy while it gets ready. */
function Act({
  on,
  busy = false,
  icon,
  words,
  onPress,
}: {
  on: boolean;
  busy?: boolean;
  icon: React.ReactNode;
  words: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      size={BUTTON_SIZE.COMPACT}
      icon={
        on ? (
          <StatusGlyph tone={STATUS_TONE.COMPLETE} label="On" hinted={false}>
            {icon}
          </StatusGlyph>
        ) : (
          icon
        )
      }
      {...(busy ? { busy: true, busyLabel: "Getting ready" } : {})}
      onClick={onPress}
    >
      {words}
    </Button>
  );
}

function Stop({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return on ? (
    <IconButton label={label} icon={<GLYPH.CLOSE />} size={BUTTON_SIZE.COMPACT} onClick={onPress} />
  ) : undefined;
}

function PortTablesExample(): React.JSX.Element {
  const [mac, setMac] = useState<ReadonlySet<number>>(new Set([5173]));
  const [team, setTeam] = useState<number | undefined>(3001);

  const turn = (port: number, on: boolean) =>
    setMac((was) => {
      const next = new Set(was);

      if (on) next.add(port);
      else next.delete(port);

      return next;
    });

  return (
    <>
      <CatalogSection id="port-tables-places" title="This Mac and Team link">
        <div className="catalog-column">
          <PortTable label="Ports" portLabel="Port" columns={COLUMNS}>
            {PORTS.map(({ port, detail }) => (
              <PortTableRow key={port} port={port} detail={detail}>
                <PortTableCell
                  stop={
                    <Stop
                      on={mac.has(port)}
                      label={`Stop forwarding ${port}`}
                      onPress={() => turn(port, false)}
                    />
                  }
                >
                  <Act
                    on={mac.has(port)}
                    icon={<ArrowUpRight />}
                    words="Open"
                    onPress={() => turn(port, true)}
                  />
                </PortTableCell>
                <PortTableCell
                  stop={
                    <Stop
                      on={team === port}
                      label={`Stop sharing ${port}`}
                      onPress={() => setTeam(undefined)}
                    />
                  }
                >
                  <Act
                    on={team === port}
                    icon={<LinkIcon />}
                    words="Share"
                    onPress={() => setTeam(port)}
                  />
                </PortTableCell>
              </PortTableRow>
            ))}
          </PortTable>
        </div>
      </CatalogSection>
      <CatalogSection id="port-tables-busy" title="An action getting ready">
        <div className="catalog-column">
          <PortTable label="Ports" portLabel="Port" columns={COLUMNS}>
            <PortTableRow port={5173} detail="vite dev">
              <PortTableCell>
                <Act
                  on={false}
                  busy
                  icon={<ArrowUpRight />}
                  words="Open"
                  onPress={() => undefined}
                />
              </PortTableCell>
              <PortTableCell>
                <Act on={false} icon={<LinkIcon />} words="Share" onPress={() => undefined} />
              </PortTableCell>
            </PortTableRow>
          </PortTable>
        </div>
      </CatalogSection>
      <CatalogSection id="port-tables-one-place" title="One place, where nothing reaches this Mac">
        <div className="catalog-column">
          <PortTable label="Ports" portLabel="Port" columns={[COLUMNS[1]]}>
            <PortTableRow port={5173} detail="vite dev">
              <PortTableCell>
                <Act on={false} icon={<LinkIcon />} words="Share" onPress={() => undefined} />
              </PortTableCell>
            </PortTableRow>
          </PortTable>
        </div>
      </CatalogSection>
      <CatalogSection id="port-tables-empty" title="No port listed">
        <div className="catalog-column">
          <PortTable
            label="Ports"
            portLabel="Port"
            columns={COLUMNS}
            empty="Nothing is running yet. Ports show here once the agent starts a server."
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const PORT_TABLES_EXAMPLE: Example = {
  id: "port-tables",
  title: "Port tables",
  Render: PortTablesExample,
};
