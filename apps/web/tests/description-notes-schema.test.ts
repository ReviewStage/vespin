import { descriptionNotesSchema } from "@repo/features/description-notes";
import { jsonSchemaGoldenRoot, settleJsonSchemaGolden } from "@repo/wire/testing";
import { test } from "vitest";

/**
 * The notes a description is written in, as the JSON Schema a model is
 * shown: a list of notes, each adding a point under a heading, correcting a
 * phrase, or striking a line. A coding agent's `edit_description` tool takes
 * this schema as its input, so a model is shown these bytes as a tool
 * definition; they are recorded and move only under `APP_UPDATE_FIXTURES=1`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

test("a description's notes name only the description's headings, with no account or plan to name", async () => {
  await settleJsonSchemaGolden(ROOT, "description-notes-output", descriptionNotesSchema);
});
