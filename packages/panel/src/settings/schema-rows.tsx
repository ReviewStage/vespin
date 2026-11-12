import {
  type AppSettingField,
  isAppSettingId,
  type SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingSection,
  type SettingsRowsInput,
  settingFromOption,
  settingRowsForPage,
} from "@repo/settings";
import type { FootRow, RowActions } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { APP_SETTING_KIND, APP_TOGGLE_VALUE } from "@repo/wire/app-settings";
import { useSettingRowWrite } from "./row-write.js";
import { SelectRow } from "./select-row.js";
import { SwitchRow } from "./switch-row.js";

/**
 * Options of a section's own in a choice's menu, beyond the schema's: the
 * schema's option they stand for in the stored setting, each listed by its
 * value and words, the one chosen, and what picking one does, which stores
 * that option and records which of its own was picked.
 */
export interface OwnOptions {
  /** The schema's option every own option stores; listed itself only while it is stored and no own option is chosen. */
  readonly token: string;
  /** Each own option by its value and words, which are a person's own and kept masked in a screen recording, and the acts its ⋯ opens. */
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly actions?: RowActions | undefined;
  }[];
  readonly chosen: string | undefined;
  readonly pick: (value: string) => void;
}

/**
 * What a section adds to a choice's menu beyond the schema's options, read at
 * run time from what the schema cannot know: the heading each option stands
 * under, options of its own, rows pinned under the list that act rather
 * than pick, and what stopped the section's own act at the row.
 */
export interface ChoiceMenu {
  readonly section?: ((token: string) => string | undefined) | undefined;
  readonly own?: OwnOptions | undefined;
  readonly foot?: readonly FootRow[] | undefined;
  readonly error?: ShownError | undefined;
}

/** One value a choice's control offers, as the schema hands it. */
type SettingOption = NonNullable<
  ReturnType<typeof settingRowsForPage>[number]["control"]
>["options"][number];

/** A toggle's row: the shared switch (`switch-row.tsx`), writing its setting through a mutation of its own, and telling its section of each turn in the press itself, where it asks. */
function SchemaToggleRow({
  id,
  field,
  label,
  detail,
  checked,
  onTurned,
}: {
  id: string;
  field: AppSettingField;
  label: string;
  detail: string | undefined;
  checked: boolean;
  onTurned: ((enabled: boolean) => void) | undefined;
}): React.JSX.Element {
  const stored = useSettingRowWrite(
    field,
    (enabled: boolean) => enabled,
    (value) => value === true,
    true,
  );

  const write =
    onTurned === undefined
      ? stored
      : {
          ...stored,
          run: (enabled: boolean) => {
            onTurned(enabled);
            stored.run(enabled);
          },
        };

  return (
    <SwitchRow
      {...(isAppSettingId(id) ? { anchor: id } : undefined)}
      label={label}
      labelReplayUnmasked
      detail={detail}
      checked={checked}
      write={write}
    />
  );
}

/**
 * A choice's row: the shared pop-up (`select-row.tsx`), whose menu searches
 * where the schema gives the set a search field and reads whole where it
 * does not, each option wearing the faces its section hands it, where it
 * hands some, writing its setting through a mutation of its own.
 */
function SchemaChoiceRow({
  id,
  field,
  view,
  label,
  detail,
  value,
  options,
  search,
  faces,
  icons,
  action,
  menu,
}: {
  id: string;
  field: AppSettingField;
  view: SettingsRowsInput;
  label: string;
  detail: string | undefined;
  value: string;
  options: readonly SettingOption[];
  /** What an option's token shows beside its words, where it shows anything. */
  faces: ((token: string) => React.ReactNode) | undefined;
  /** The glyph an option's token leads with, where it leads with one. */
  icons: ((token: string) => React.ReactNode) | undefined;
  /** The searchable menu's empty field words, for a set long enough to search. */
  search: string | undefined;
  /** A control of the row's own beside the pop-up, where its section hands one. */
  action: React.ReactNode;
  /** What the section adds to the menu, where it adds anything. */
  menu: ChoiceMenu | undefined;
}): React.JSX.Element {
  const write = useSettingRowWrite(field, (token: string) => settingFromOption(field, token, view));
  const own = menu?.own;

  // Note that an own option stands for its token in the setting, so the menu draws the own option chosen where the token is stored.
  const shown =
    own !== undefined && value === own.token && own.chosen !== undefined ? own.chosen : value;

  const listed = [
    ...(own?.options.map((option) => ({
      ...option,
      section: menu?.section?.(own.token),
      masked: true,
    })) ?? []),
    ...options
      .filter((option) => option.value !== own?.token || shown === own.token)
      .map((option) => ({
        ...option,
        ...(faces === undefined ? undefined : { faces: faces(option.value) }),
        ...(icons === undefined ? undefined : { icon: icons(option.value) }),
        section: menu?.section?.(option.value),
      })),
  ];

  return (
    <SelectRow
      label={label}
      labelReplayUnmasked
      detail={detail}
      value={shown}
      options={listed}
      // A token the set does not hold, or the one already stored, is not written, so a stale menu or a repeat pick writes nothing.
      parse={(token) =>
        token !== shown && options.some((option) => option.value === token) ? token : undefined
      }
      pickOther={(token) => {
        if (own === undefined || token === shown) return false;

        if (!own.options.some((option) => option.value === token)) return false;
        own.pick(token);

        return true;
      }}
      placeholder={search}
      {...(isAppSettingId(id) ? { anchor: id } : undefined)}
      action={action}
      foot={menu?.foot}
      error={menu?.error}
      write={write}
    />
  );
}

/**
 * Every ordinary row one section of a settings page draws, from the schema and
 * nothing else: which page and section a setting stands in, where in that
 * section, whether it is drawn right now, what its control offers, and the
 * line drawn under its label are the entry's own answers. A page component that decided any of it for itself would
 * be a second record of the same fact, and the two would drift. What the
 * section may add is a choice's faces or glyphs, read at run time from what the
 * schema cannot know, such as the account's own picture or a permission
 * mode's glyph, a control
 * beside a choice's pop-up that acts on its value, such as a sound's Play,
 * what a choice's menu holds beyond its options, such as a sound's Yours
 * heading and its Upload, and what a toggle's turn asks of the platform in the press itself, such as
 * a browser's leave to post notifications.
 */
export function SchemaSettingRows({
  page,
  section = SETTING_SECTION.MAIN,
  view,
  faces,
  icons,
  actions,
  menus,
  onTurned,
}: {
  page: (typeof SCHEMA_SETTINGS_PAGE)[keyof typeof SCHEMA_SETTINGS_PAGE];
  section?: SettingSection;
  view: SettingsRowsInput;
  /** What each of a choice's options shows beside its words, by the setting it stores and its token; none where its options are words alone. */
  faces?: ((field: AppSettingField, token: string) => React.ReactNode) | undefined;
  /** The glyph each of a choice's options leads with, by the setting it stores and its token; none where its options are words alone. */
  icons?: ((field: AppSettingField, token: string) => React.ReactNode) | undefined;
  /** The control a choice's row draws beside its pop-up, by the setting it stores; none where its pop-up stands alone. */
  actions?: ((field: AppSettingField) => React.ReactNode) | undefined;
  /** What a choice's menu holds beyond its options, by the setting it stores; none where it lists the options alone. */
  menus?: ((field: AppSettingField) => ChoiceMenu | undefined) | undefined;
  /** What a toggle's turn does beside its write, in the press itself, by the setting it stores; none where the write is all. */
  onTurned?: ((field: AppSettingField, enabled: boolean) => void) | undefined;
}): React.JSX.Element {
  const rows = settingRowsForPage(page, section, view).flatMap((row) => {
    const { field, entry, control } = row;

    if (entry.kind === APP_SETTING_KIND.TOGGLE) {
      return [
        <SchemaToggleRow
          key={entry.id}
          id={entry.id}
          field={field}
          label={entry.label}
          detail={entry.detail}
          checked={entry.value === APP_TOGGLE_VALUE.ON}
          onTurned={onTurned === undefined ? undefined : (enabled) => onTurned(field, enabled)}
        />,
      ];
    }

    if (entry.kind !== APP_SETTING_KIND.CHOICE || !control) return [];

    return [
      <SchemaChoiceRow
        key={entry.id}
        id={entry.id}
        field={field}
        view={view}
        label={entry.label}
        detail={entry.detail}
        value={control.value}
        options={control.options}
        search={control.search}
        faces={faces === undefined ? undefined : (token) => faces(field, token)}
        icons={icons === undefined ? undefined : (token) => icons(field, token)}
        action={actions?.(field)}
        menu={menus?.(field)}
      />,
    ];
  });

  return <>{rows}</>;
}
