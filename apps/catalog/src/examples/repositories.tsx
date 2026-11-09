/**
 * repositories.tsx -- a repository as every surface names it.
 *
 * A line shows its owner's picture, then its name. Where another repository
 * in the view shares the name, the line says `owner/name`. No repository is a
 * crossed-out folder. A glyph slot holds the picture, or that folder, alone.
 * The card shows the owner under the name. A workspace's repositories stand
 * one line each, `owner/name`, a Token mark where a member's token reaches
 * one, in a list about six lines tall that scrolls the rest. The catalog
 * asks nothing of the network, so every picture stands as the repository's
 * glyph.
 */

import {
  GAP,
  Inline,
  NoRepositoryGlyph,
  RepositoryCard,
  RepositoryLines,
  RepositoryName,
  RepositoryPicture,
  Stack,
} from "@repo/ui";
import { repositoryLabel } from "@repo/ui/task-list-model";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** The repositories one view names, two of which share a name. */
const VIEW = [
  { repository: "acme/relay" },
  { repository: "acme/site" },
  { repository: "labs/site" },
  { repository: null },
] as const;

/** A workspace's repositories, more than the list stands tall, two reached on a member's token. */
const REACHED = [
  ...["relay", "site", "docs", "infra", "mobile", "design", "billing", "search"].map((name) => ({
    repository: `acme/${name}`,
  })),
  { repository: "labs/site", token: true },
  { repository: "labs/release-notifications-for-every-workspace", token: true },
];

function Repositories(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="repository-names" title="Named in a line, in a narrow column">
        <div className="catalog-narrow">
          <Stack gap={GAP.CONTROL}>
            {VIEW.map(({ repository }) => (
              <RepositoryName
                key={repository ?? "none"}
                repository={repository}
                label={repository === null ? undefined : repositoryLabel(repository, VIEW)}
                pictures={false}
              />
            ))}
            <RepositoryName
              repository="acme/release-notifications-for-every-workspace"
              pictures={false}
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="repository-glyphs" title="In a glyph's slot: picture, no repository">
        <Inline gap={GAP.CONTROL}>
          <RepositoryPicture repository="acme/relay" pictures={false} />
          <NoRepositoryGlyph />
        </Inline>
      </CatalogSection>
      <CatalogSection id="repository-lines" title="A workspace's repositories, scrolling past six">
        <div className="catalog-narrow">
          <RepositoryLines
            label="Repositories agents reach"
            repositories={REACHED}
            pictures={false}
          />
        </div>
      </CatalogSection>
      <CatalogSection id="repository-card" title="Card">
        <RepositoryCard repository="acme/relay" pictures={false} />
      </CatalogSection>
    </>
  );
}

export const REPOSITORIES_EXAMPLE: Example = {
  id: "repositories",
  title: "Repositories",
  Render: Repositories,
};
