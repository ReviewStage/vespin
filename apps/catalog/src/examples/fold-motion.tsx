import {
  MARK_PROVIDER,
  type MarkProvider,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  RepositoryLines,
  SETTINGS_ROW_INDENT,
  SettingsFoldRow,
  SettingsPage,
  SettingsRow,
  SettingsRowsFold,
  SettingsSection,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * fold-motion.tsx -- a settings page whose card folds open what its rows own,
 * as Settings › Workspace's connections do: a GitHub account's repositories
 * standing under its row while it is open, at once, and the integrations and
 * section under it jumping to their new places.
 */

/** A provider's mark, at the size a row's leading mark stands. */
function Mark({ provider }: { provider: MarkProvider }) {
  return <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ROW} />;
}

/** A connected integration's row, which folds nothing. */
function Connected({
  label,
  provider,
}: {
  label: string;
  provider: MarkProvider;
}): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      leading={<Mark provider={provider} />}
      description="Issues, events, and releases"
    />
  );
}

function FoldingPage(): React.JSX.Element {
  return (
    <SettingsPage title="Workspace">
      <SettingsSection title="Workspace connections">
        <SettingsRowsFold
          label="GitHub accounts"
          opened={1}
          head={(chevron) => (
            <SettingsRow
              label="GitHub"
              leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
              description="Pull requests and repositories"
              end={() => chevron}
            />
          )}
          rows={
            <SettingsFoldRow
              indent={SETTINGS_ROW_INDENT.MARK}
              label="analytical-engine"
              description="All 6 repositories"
              leading={<Mark provider={MARK_PROVIDER.GITHUB} />}
              foldLabel="analytical-engine's repositories"
            >
              <RepositoryLines
                label="analytical-engine's repositories"
                repositories={["mill", "store", "cards", "printer", "notes", "bernoulli"].map(
                  (name) => ({ repository: `analytical-engine/${name}` }),
                )}
                pictures={false}
              />
            </SettingsFoldRow>
          }
        />
        <Connected label="Slack" provider={MARK_PROVIDER.SLACK} />
        <Connected label="Sentry" provider={MARK_PROVIDER.SENTRY} />
      </SettingsSection>
      <SettingsSection title="Leave">
        <SettingsRow label="Leave workspace" description="You lose access to its tasks." />
      </SettingsSection>
    </SettingsPage>
  );
}

function FoldMotionExamples(): React.JSX.Element {
  return (
    <CatalogSection id="fold-motion-settings" title="A fold in a settings card">
      <div className="catalog-settings-frame catalog-settings-frame-tall">
        <FoldingPage />
      </div>
    </CatalogSection>
  );
}

export const FOLD_MOTION_EXAMPLE: Example = {
  id: "fold-motion",
  title: "Fold motion",
  Render: FoldMotionExamples,
};
