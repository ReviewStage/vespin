import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { RESOURCE_SORT, type ResourceFact, type ResourceSort, ResourcesPopover } from "@repo/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import { useMemo, useState } from "react";
import { askAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { QUERY_ROOT } from "../query-keys.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { macResourcesView } from "./mac-resources-view.js";

/**
 * mac-resources.tsx -- Resources, beside Back and Forward in the sidebar's title-bar row: what this Mac spends on the app, every one of its processes' CPU and memory, the host's agents and the shells it opened among them.
 *
 * Drawn in the desktop app alone, since only it reads the Mac's process
 * table (`MAC_RESOURCES_READ`), and only where the sidebar stands, as Back
 * and Forward are. The processes are read while the popover stands open,
 * and read again every couple of seconds while it does, so a closed popover
 * costs the Mac nothing. They are sorted by memory until a heading chooses
 * another column.
 */

/** What the popover says: its name, its totals' labels, its table's headings, what it is before the first read, and what its Copy copies. */
const WORDS = {
  TITLE: "Resources",
  CPU: "CPU",
  MEMORY: "Memory",
  NAME: "Name",
  MEM: "Mem",
  READING: "Reading this Mac's processes…",
  COPY_WHAT: "processes",
} as const;

/** How often the processes are read again while the popover stands open. */
const READ_EVERY = Duration.seconds(2);

/** The app's processes on this Mac, read only while `open`, and again every couple of seconds. */
function macResourcesQuery(open: boolean) {
  return queryOptions({
    queryKey: [QUERY_ROOT.MAC_RESOURCES],
    queryFn: () => askAct(ACT_KIND.MAC_RESOURCES_READ),
    enabled: open,
    refetchInterval: open ? Duration.toMillis(READ_EVERY) : false,
    retry: false,
  });
}

/** The popover's opener and what it hangs, while it stands open. */
function MacResources(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<ResourceSort>(RESOURCE_SORT.MEMORY);
  const { data } = useQuery(macResourcesQuery(open));

  const view = useMemo(
    () => (data === undefined ? undefined : macResourcesView(data.processes, sort)),
    [data, sort],
  );

  const facts: readonly ResourceFact[] = [
    { label: WORDS.CPU, value: view?.cpu ?? "—" },
    { label: WORDS.MEMORY, value: view?.memory ?? "—" },
  ];

  return (
    <ResourcesPopover
      label={WORDS.TITLE}
      open={open}
      onOpenChange={setOpen}
      facts={facts}
      headings={{ name: WORDS.NAME, cpu: WORDS.CPU, memory: WORDS.MEM }}
      sort={sort}
      onSort={setSort}
      rows={view?.rows}
      empty={WORDS.READING}
      copy={{ text: view?.text ?? "", what: WORDS.COPY_WHAT, run: copyThroughShell }}
    />
  );
}

/** Resources, in the desktop app alone. */
export function MacResourcesButton(): React.JSX.Element | null {
  const desktop =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;

  return desktop ? <MacResources /> : null;
}
