/**
 * share-page-fixture.ts -- the share page's scratch data, which a launch opens the page on (`-sharePage true`) so a flow shoots it: a workspace's places, and a shared link and screenshot, all synthetic.
 */

import { SHARE_DESTINATION_KIND, type ShareDestinations } from "@repo/features/ios-share-wire";
import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS } from "@repo/features/task-wire";

/** When the fixture's places last moved, counted back from a fixed instant so the shots never move. */
const AT = 1_764_300_000_000;

/** A workspace's places, newest moved first within each kind. */
export const FIXTURE_DESTINATIONS: ShareDestinations = {
  workspaceId: "workspace-stage",
  rows: [
    {
      kind: SHARE_DESTINATION_KIND.MANAGER,
      id: "m-ios",
      name: "iOS engineer",
      face: { character: MANAGER_FACE_CHARACTER.CAT, color: MANAGER_FACE_COLOR.TEAL },
      at: AT - 1,
    },
    {
      kind: SHARE_DESTINATION_KIND.MANAGER,
      id: "m-release",
      name: "Release captain",
      face: { character: MANAGER_FACE_CHARACTER.PLANET, color: MANAGER_FACE_COLOR.PURPLE },
      at: AT - 50,
    },
    {
      kind: SHARE_DESTINATION_KIND.MANAGER,
      id: "m-growth",
      name: "Growth",
      face: { character: MANAGER_FACE_CHARACTER.MUG, color: MANAGER_FACE_COLOR.ORANGE },
      at: AT - 90,
    },
    {
      kind: SHARE_DESTINATION_KIND.THREAD,
      id: "i-pick",
      title: "Pick a share sheet design",
      agentId: "a-mock",
      holder: "iOS share sheet",
      holderStatus: TASK_STATUS.IN_PROGRESS,
      at: AT - 4,
    },
    {
      kind: SHARE_DESTINATION_KIND.THREAD,
      id: "i-copy",
      title: "Words for the empty Inbox",
      agentId: "a-widget",
      holder: "Inbox widget counts",
      holderStatus: TASK_STATUS.TODO,
      at: AT - 60,
    },
    {
      kind: SHARE_DESTINATION_KIND.TASK,
      id: "t-share",
      name: "iOS share sheet",
      status: TASK_STATUS.IN_PROGRESS,
      at: AT - 6,
    },
    {
      kind: SHARE_DESTINATION_KIND.TASK,
      id: "t-refresh",
      name: "Fix the refresh on resume",
      status: TASK_STATUS.TODO,
      at: AT - 70,
    },
    {
      kind: SHARE_DESTINATION_KIND.AGENT,
      id: "a-refresh",
      name: "Refresh fix",
      task: "Fix the refresh on resume",
      harness: MODEL_PROVIDER.ANTHROPIC,
      at: AT - 8,
    },
    {
      kind: SHARE_DESTINATION_KIND.AGENT,
      id: "a-widget",
      name: "Widget counts",
      task: "Inbox widget counts",
      harness: MODEL_PROVIDER.OPENAI,
      at: AT - 80,
    },
  ],
};

/** What was shared, as the field lays it in: a line typed, a page's link, and a screenshot's marker. */
export const FIXTURE_SHARED_WORDS =
  "Can we adopt this? [@Swift concurrency migration guide](https://www.swift.org/migration/documentation/migrationguide/) [Picture 1] ";

/** The shared screenshot, a synthetic picture. */
export const FIXTURE_SHARED_PICTURES = [
  {
    id: "shared-1",
    name: "Picture 1",
    address:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAFACAIAAACa28HeAAADIUlEQVR42u3dscmuMBiGYQcRl7C1cCxXcRnrVI4T7LSxFATREJML7vopvvfqcvxP07addFnjJxAcgkNwCA7BITgEh+AQHIJDgkNwCA7BITgEh+AQHIJDcEhwCA7BITgEh+BQ5jhi3KTL4BAcgkNwCA7BITgEh+AQHIJDeoZjGEZlGxyCQ3AIDsEhOAQHHHDAAQcccMABBxyCQ3AIDsEhOAQHHHDAAQcccPgHxoJDcAgOwSE4BIfgEBwSHHoXxz739y3TfXay2YHDTgIcfujiduCwA4cdOOzAYQcOO3A4BhyOAYdjwAEHHHDAAYedD3H4oT28wQEHHHbgsAOHHTjswGEHDjtwOAYcjgGHY8ABBxwe3jy8wWEHDjtw2IHDDhx24HBUOBwDDseAAw444IADDju+W7HjVdYOHHbgsAOHHTgcAw7HgMMx4IADDjjswGEHDju+W7HjVdYOHHbgcAw4HAMOx4ADDjjggAMOO3DYgcMOHHZ8t2LHq6xjwOEYcDgGHHDAAQcccNiBww4cduCwA4cdOOz4bsXBvMo6BhxwwAEHHHDYgcMOHHbgsAOHHTjswOEYcDiG71b80B7e4IADDjjgsAOHHTjswGEHDjtwOAYcjgGHY8ABBxwe3jy8wWEHDjtw2IHDDhx24LADh2PA4RhwwAEHHHDAYcd3K3a8ytqBww4cduCwA4djwOEYcDgGHHDAAQccr+BQncEhOASH4BAcgkNwCA7BITgEhwSH4FAqHCGsKiw4BIfgEByCQ3AIDsEhOOCAAw444BAcgkM54ZAnewkOwSE4BIfgEByCQ3AIDsEhwSE45FvZ/z+RwwEHHIJDcLguHHDAAQcccMABBxxwwAEHHHDAAYfgUK045MlegkNwCA7BITgEh+AQHIJDcEhwCA55spe/fS44BIfgEByCQ3DAAQcccMAhOASH4BAc8v/Kyr/nEByCQ3BIcAgOwSE4BIfgEByCQ3AIDk/2/rw1HHDAAQcccMABBxxwwAEHHIJDcAgOOOCAAw444IADDk/2gkNwCA7BITgEh+CQ4BAcgkNwCA7BITgEh+AQHNLZAaXRjVFgoK/eAAAAAElFTkSuQmCC",
  },
];
