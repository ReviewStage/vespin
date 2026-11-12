/**
 * mac-resources-view.ts -- what the Resources popover draws of the app's processes: each named, its figures said, children under their parent and siblings sorted by the column chosen, the totals over them, and the list as words to copy.
 *
 * The host answers the processes flat, each naming its parent
 * (`MAC_RESOURCES_READ`); here they become the rows the table draws in
 * order. A process stands under the one that started it however the rows
 * are sorted, its siblings ordered among themselves, so a shell's commands
 * never leave their shell. A process's own figures never count its
 * children's, so the totals are the sum of every row, as Activity Monitor
 * adds an app's processes.
 */

import { formatBytes } from "@repo/features/number-format";
import { MAC_PROCESS_KIND, type MacProcess, type MacProcessKind } from "@repo/host/contract";
import { RESOURCE_SORT, type ResourceRow, type ResourceSort } from "@repo/ui";

/** What the app calls each of Electron's processes and its host; a utility and a child go by the name the system gives them. */
const KIND_NAME: Partial<Record<MacProcessKind, string>> = {
  [MAC_PROCESS_KIND.MAIN]: "Main",
  [MAC_PROCESS_KIND.RENDERER]: "Renderer",
  [MAC_PROCESS_KIND.GPU]: "GPU",
  [MAC_PROCESS_KIND.HOST]: "Host",
};

/** The app's processes as the popover draws them. */
export interface MacResourcesView {
  readonly rows: readonly ResourceRow[];
  /** The CPU of every process together, said. */
  readonly cpu: string;
  /** The memory of every process together, said. */
  readonly memory: string;
  /** The list as Copy puts it on the clipboard: the totals, then a line a process in the rows' order, its pid, its parent's, and its executable after its figures, so a reader can find it in Activity Monitor or `ps`. */
  readonly text: string;
}

/** A process's CPU, in percent of one core, said to one place: "2.3%". */
function cpuWords(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

/** The order of two siblings by the column chosen: a name from A, a figure from the largest. */
function compare(sort: ResourceSort): (a: MacProcess, b: MacProcess) => number {
  if (sort === RESOURCE_SORT.NAME) return (a, b) => nameOf(a).localeCompare(nameOf(b));

  if (sort === RESOURCE_SORT.CPU) return (a, b) => b.cpu - a.cpu;

  return (a, b) => b.memory - a.memory;
}

function nameOf(each: MacProcess): string {
  return KIND_NAME[each.kind] ?? each.name;
}

/** `processes` as the popover draws them, sorted by `sort`. */
export function macResourcesView(
  processes: readonly MacProcess[],
  sort: ResourceSort,
): MacResourcesView {
  const answered = new Set(processes.map((each) => each.pid));
  const children = new Map<number | undefined, MacProcess[]>();

  for (const each of processes) {
    // A parent that is not answered leaves its child at the top rather than lost.
    const parent = each.parent !== undefined && answered.has(each.parent) ? each.parent : undefined;
    const siblings = children.get(parent);

    if (siblings === undefined) children.set(parent, [each]);
    else siblings.push(each);
  }

  const order = compare(sort);
  const rows: ResourceRow[] = [];
  const lines: string[] = [];

  const walk = (parent: number | undefined, depth: number) => {
    for (const each of [...(children.get(parent) ?? [])].sort(order)) {
      const row = {
        key: String(each.pid),
        name: nameOf(each),
        depth,
        cpu: cpuWords(each.cpu),
        memory: formatBytes(each.memory),
      };

      rows.push(row);
      lines.push(
        `${row.name} ${row.cpu} ${row.memory} (pid=${each.pid} ppid=${each.ppid} cmd=${each.command})`,
      );
      walk(each.pid, depth + 1);
    }
  };

  walk(undefined, 0);
  const cpu = cpuWords(processes.reduce((sum, each) => sum + each.cpu, 0));
  const memory = formatBytes(processes.reduce((sum, each) => sum + each.memory, 0));

  return { rows, cpu, memory, text: [`CPU ${cpu} Memory ${memory}`, ...lines].join("\n") };
}
