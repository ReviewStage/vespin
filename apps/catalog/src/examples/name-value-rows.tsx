import { GAP, type NameValueRow, NameValueRows, Stack } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * name-value-rows.tsx -- NameValueRows as Add variables draws it: masked
 * values as secrets, plain values as configs, a line whose name is wrong, a
 * line whose name replaces a saved one, and a `.env` pasted into a name
 * spread a pair to a line.
 */

/** One variable a `.env` line sets. */
interface Pair {
  readonly name: string;
  readonly value: string;
}

/** A `.env` line read as a pair, its `export` and quotes dropped. */
function pairOf(line: string): Pair {
  const bare = line.replace(/^export\s+/u, "");
  const at = bare.indexOf("=");

  return {
    name: bare.slice(0, at).trim(),
    value: bare
      .slice(at + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/u, "$2"),
  };
}

let nextKey = 0;

/** Lines the example holds, as Add variables holds its drafts. */
function Held({
  secret,
  start,
}: {
  secret: boolean;
  start: readonly NameValueRow[];
}): React.JSX.Element {
  const [rows, setRows] = useState<readonly NameValueRow[]>(start);

  const patch = (key: string, change: Partial<NameValueRow>) =>
    setRows((now) => now.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    <NameValueRows
      rows={rows}
      secret={secret}
      namePlaceholder="NAME"
      onName={(key, name) => patch(key, { name })}
      onValue={(key, value) => patch(key, { value })}
      onRemove={(key) => setRows((now) => now.filter((row) => row.key !== key))}
      onPasteLines={(key, text) => {
        const lines = text.split(/\r?\n/u).filter((line) => line.includes("="));

        if (lines.length === 0) return false;
        setRows((now) => [
          ...now.filter((row) => row.key !== key),
          ...lines.map((line) => ({ key: `pasted-${nextKey++}`, ...pairOf(line) })),
        ]);

        return true;
      }}
    />
  );
}

function NameValueRowsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="name-value-secrets" title="Secrets, with a problem and a note">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Held
              secret
              start={[
                { key: "a", name: "DATABASE_URL", value: "postgres://catalog" },
                {
                  key: "b",
                  name: "1BAD-NAME",
                  value: "x",
                  problem: "Use letters, digits, and _, not starting with a digit.",
                },
                {
                  key: "c",
                  name: "SENTRY_AUTH_TOKEN",
                  value: "sntrys_catalog",
                  note: "Replaces the saved SENTRY_AUTH_TOKEN.",
                },
              ]}
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="name-value-configs" title="Configs, one line; paste a .env into Name">
        <div className="catalog-column">
          <Held secret={false} start={[{ key: "d", name: "", value: "" }]} />
        </div>
      </CatalogSection>
    </>
  );
}

export const NAME_VALUE_ROWS_EXAMPLE: Example = {
  id: "name-value-rows",
  title: "Name and value rows",
  Render: NameValueRowsExample,
};
