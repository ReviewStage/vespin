// index.ts -- @repo/ui-native: the iOS app's components over @expo/ui's SwiftUI, its Markdown in React Native views, and the brand's tokens they draw with.

export { useAnnounced, useReduceTransparency } from "./accessibility.js";

export { AccountBarItem, AccountButton, type BarAccount } from "./account-button.js";

export { ArchivedBar, ContinueLine } from "./agent-end.js";

export {
  ANSWER_FIELD,
  type AnswerField,
  type AnswerFieldKind,
  AnswerFields,
  type AskAct,
  AskActs,
  AskNote,
  StepList,
} from "./ask-card.js";

export {
  ConfirmAsk,
  QUIET_ROW_QUESTION,
  type RowAsker,
  RowAsking,
  type RowQuestion,
  useRowAsker,
} from "./asks.js";

export { AuthPage } from "./auth-page.js";

export { type BarSubtitle, StackSubtitle } from "./bar-title.js";

export { BRAND_MARK_ASSET, BrandMark } from "./brand-mark.js";

export {
  BUTTON_LOOK,
  BUTTON_SIZE,
  Button,
  type ButtonLook,
  type ButtonSize,
  Chip,
  type FieldAct,
  FieldChip,
  type FieldMenu,
  FollowingChip,
  LabelChip,
  type ListScopes,
  PriorityChip,
  SCOPE_LOOK,
  type Scope,
  type ScopeLook,
  ScopePicker,
  StatusChip,
} from "./button.js";

export {
  CallAccessory,
  CallCardRow,
  type CallPresses,
  COMPOSER_CALL,
  type ComposerCall,
  type StandingCallCard,
} from "./call.js";

export type { CaretAtWord } from "./caret-at-word.js";

export { ChangedFileRow } from "./changed-file-row.js";

export type { ChannelFaces } from "./channel-row.js";

export { ChipMarkProvider, useChipMarkOf } from "./chip-mark.js";

export {
  CHIP_MARK,
  type ChipMark,
  type ChipMarkOf,
  type ChipMarksHeld,
  chipMarkOf,
} from "./chip-mark-model.js";

export { type Choice, ChoiceList, type NoneChoice } from "./choice-list.js";

export { CHOICE_MEDIA, type ChoiceMedia, type ChoiceMediaKind } from "./choice-media.js";

export {
  Composer,
  type ComposerDictation,
  ComposerFoot,
  type ComposerMenu,
  type ComposerPills,
  type ComposerSaving,
  type ComposerSendAs,
  DICTATION_PHASE,
  type DictationPhase,
  wordsHandedBack,
} from "./composer.js";

export {
  type AttachedPicture,
  AttachedPictures,
  EditingLine,
  type MentionCrumb,
  type MentionSuggestion,
  type MentionSuggestionGroup,
  MentionSuggestions,
  type SkillSuggestion,
  SkillSuggestions,
} from "./composer-head.js";

export type { ComposerSend } from "./composer-press.js";

export {
  ConversationEntryRow,
  type EntryStanding,
  type ThreadComment,
  ThreadRow,
} from "./conversation-rows.js";

export { type DockChip, DockChips, DockPanel } from "./dock-chips.js";

export {
  DocumentField,
  type DocumentFieldHandle,
  type DocumentFieldOpening,
  OPENS_AT_START,
} from "./document-field.js";

export { editedBlocks, type FieldLine, fieldLines } from "./document-field-model.js";

export {
  DocumentPage,
  type DocumentPageMentions,
  MentionDock,
  MentionFoot,
} from "./document-page.js";

export { EmptyState, NoSelection, TRY_AGAIN_WORDS } from "./empty-state.js";

export {
  FailureNoticeBars,
  FailureNoticeLayer,
  FailureNoticeProvider,
  type FailureNotices,
  useFailureNotices,
} from "./failure-notice.js";

export { NOTICE_KIND, type NoticeAsk, type NoticeKind } from "./failure-notice-model.js";

export { releaseFields } from "./field-focus.js";

export { type FiringLook, firingLook } from "./firing-look.js";

export {
  AttachRow,
  DATE_PICK_PART,
  DatePickRow,
  MenuPickRow,
  WORDS_LOOK,
  WordsField,
} from "./form-rows.js";

export { GlassBar, GlassDock, useDockRoom } from "./glass-bar.js";

export {
  GLYPH,
  type Glyph,
  glyphSymbol,
  type LucideSymbol,
  type MarkLook,
  PERMISSION_MODE_GLYPH,
  runsOnGlyph,
  sectionEmoji,
  sectionGlyph,
  UNASSIGNED_UNDER,
} from "./glyph.js";

export { BUZZ, type Buzz, buzz } from "./haptics.js";

export {
  HELD_ANSWER,
  type HeldAnswer,
  type HeldCall,
  HeldCallBanner,
} from "./held-call.js";

export {
  type HeldAct,
  type Keeping,
  KeepingProvider,
  usePicturesView,
  type ViewedPicture,
} from "./held-menu.js";

export { changeSignal, heldValue, useHeldValue } from "./held-value.js";

export { INBOX_LINE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";

export { InlineHost } from "./inline-host.js";

export { INTEGRATION_MARK_ASSET, type IntegrationMarkAsset } from "./integration-marks.js";

export {
  type HeldPicture,
  heldPicture,
  KEEP_ACT,
  KEPT_KIND,
  type KeepAct,
  type Kept,
  type KeptKind,
  PICTURE_FILE_EXTENSIONS,
  pictureExtension,
} from "./keep-model.js";

export {
  NO_WRITES,
  newestValue,
  takesRowBack,
  type WriteSent,
  type WritesBook,
  writeSent,
  writeSettled,
} from "./latest-writes-model.js";

export {
  ListRow,
  type LongPressGroup,
  LongPressMenu,
  ROW_ACTION_TONE,
  type RowAction,
  type RowActionTone,
  RowDisclosure,
  type RowFold,
  type RowMenuGroup,
  type RowSubmenu,
  type RowSwipe,
  TaskRow,
} from "./list-row.js";

export { MachineAskSheet } from "./machine-ask-sheet.js";

export { managerFaceMenu } from "./manager-face-menu.js";

export { ManagerFaceRow, ManagerFaceSheet } from "./manager-face-picker.js";

export { Markdown, type MarkdownFile, type MarkdownVideo, Picture } from "./markdown.js";

export { markdownGithubPages, markdownReplyButtons, markdownShows } from "./markdown-model.js";

export { MarkdownPage } from "./markdown-page.js";

export {
  AgentTile,
  Avatar,
  FACE_KIND,
  type Face,
  type FaceKind,
  FailedMark,
  NeedsYouDot,
  TaskStatusMark,
  ToneGlyph,
  UnreadDot,
  WorkingMark,
} from "./marks.js";

export { type MediaReadSeams, type MediaReads, mediaReads } from "./media-reads-model.js";

export { MergeQueueRow } from "./merge-queue-row.js";

export { useMinute, useToday } from "./minute.js";

export {
  type ModeChoice,
  ModelChoicePopover,
  ModelChoiceSheet,
  type ModelChoices,
  type ModelOption,
} from "./model-choice-sheet.js";

export { type PageFollowing, PageHeader, type StandingMenus } from "./page-header.js";

export { PermissionAsk, type PermissionAskProps } from "./permission-ask.js";

export { PersonHead } from "./person-head.js";

export { PictureSet, type SetPicture } from "./picture-set.js";

export {
  LoaderImage,
  PICTURE_CACHE,
  PICTURE_FIT,
  type PictureById,
  PictureByIdProvider,
  type PictureCache,
  type PictureEvents,
  PictureEventsProvider,
  type PictureFit,
  type PictureRef,
  type PictureSource,
  peekPicture,
  pictureUri,
  type RemotePicture,
  type UsePictureById,
} from "./picture-source.js";

export { PillField, type PillFieldHandle } from "./pill-field.js";

export { ProblemLine } from "./problem-line.js";

export {
  PROVIDER_MARK_ASSET,
  ProviderButton,
  type ProviderMarkAsset,
} from "./provider-button.js";

export { type PullRequestAct, PullRequestCard } from "./pull-request-card.js";

export {
  type PullRequestChipFacts,
  type PullRequestChipLook,
  pullRequestChipLook,
} from "./pull-request-chip-model.js";

export {
  CHECK_LOOK,
  CHECK_SUMMARY_LOOK,
  REVIEW_LOOK,
} from "./pull-request-look.js";

export {
  BotTag,
  githubFace,
  type HeadReviewer,
  MarkRow,
  MergeActRow,
  type MergeMethodChoice,
  PullRequestHead,
  type RowCount,
  WriteNoteRow,
} from "./pull-request-page.js";

export { type QueuedLine, QueuedLines } from "./queued-lines.js";

export { RemindPickSheet } from "./remind-sheet.js";

export {
  FOOTER_TONE,
  type FooterTone,
  footerToneOf,
  LIST_LOOK,
  type ListLook,
  ListSection,
  type RowChoosing,
  RowForEach,
  RowList,
} from "./row-list.js";

export {
  agentLead,
  CHOICE_MARK,
  type ChoiceLook,
  type ChoiceMark,
  choiceLook,
  MENU_ICON,
  type MenuChoice,
  type MenuLead,
  type MenuPhotoFile,
  markLook,
  menuPhotoFile,
  personChoice,
  priorityChoice,
  repositoryChoice,
  statusChoice,
  taskChoice,
  taskLead,
  unassignedChoice,
} from "./row-menu-model.js";

export { RowPickContext } from "./row-open.js";

export {
  agentPreview,
  latestStep,
  type PreviewAgent,
  type PreviewMessage,
  previewMessages,
  type RowPreview,
  taskPreview,
  threadPreview,
} from "./row-preview-model.js";

export { NO_GROUND, SCREEN_GROUND, Screen, type ScreenGround, Spacer } from "./screen.js";

export { ScreenFailure } from "./screen-failure.js";

export { SealedPage } from "./sealed-page.js";

export { sectionGlyphColor, sectionInk } from "./section-ink.js";

export { type SentPictures, sentPictures } from "./sent-pictures-model.js";

export {
  AccountHead,
  AccountRow,
  ActionRow,
  AUTOMATION_ROW_LOOK,
  AutomationRow,
  CodeRow,
  type ConnectionLine,
  ConnectionRow,
  FORM_SPACING,
  FollowerRow,
  type FormSpacing,
  LOADING_ROW_LOOK,
  LoadingRow,
  MEMBER_ROW_LOOK,
  MemberRow,
  type MemberRowAct,
  MenuRow,
  type MenuRowAct,
  NoteRow,
  type PersonPickOption,
  PersonPickRows,
  type PickOption,
  PickRows,
  PUSH_ROW_GOES,
  PushRow,
  type PushRowGoes,
  ScriptRow,
  SettingsForm,
  ToggleRow,
  ValueRow,
  type WorkspacePickOption,
  WorkspacePickRows,
  WorkspaceRow,
} from "./settings-form.js";

export {
  type BarAction,
  type BarFootItem,
  type BarMenu,
  type BarMenuAction,
  type BarMenuEntry,
  type BarMenuGroup,
  type BarPath,
  type BarSearch,
  type ColumnBar,
  groupKey,
  isBarMenu,
  isMenuEntry,
  menuOfGroups,
  menuWithout,
  PATH_PART,
  SplitView,
  StackBarMenu,
} from "./split-view.js";

export {
  type ChipMenu,
  type ChipMenuGroup,
  MENU_CHIP_LOOK,
  MenuChip,
  StartPage,
} from "./start-page.js";

export {
  PRIORITY_MARK_SYMBOL,
  PRIORITY_MARK_TONE,
  priorityMarkUnder,
  STATUS_MARK_SYMBOL,
} from "./status-mark-model.js";

export { SUGGESTION_LOOK, type SuggestionLook } from "./suggestion-look.js";

export {
  askForName,
  askForWords,
  askToChoose,
  type ChoiceAct,
  type ChoiceAsk,
  type NameAsk,
  shareWords,
  WORDS_KIND,
  type WordsAct,
  type WordsAsk,
  type WordsKind,
} from "./system-asks.js";

export {
  AGENT_ROW_STATE,
  AgentRow,
  type AgentRowState,
  FailedReadRow,
  FieldRow,
  LINK_ROW_TONE,
  LinkRow,
  type LinkRowTone,
  RelationRow,
  TaskHead,
  VERSION_WRITER,
  VersionRow,
  type VersionWriter,
  WORDS_EDGE,
  type WordsEdge,
  WordsRow,
} from "./task-rows.js";

export {
  THREAD_MEDIA,
  type ThreadMedia,
  type ThreadMessage,
  ThreadPage,
} from "./thread-page.js";

export { BRAND_COLOR } from "./tokens/brand-colors.js";

export {
  type BarScheme,
  type BrandColors,
  ElevatedGround,
  STATUS_TONE,
  type StatusTone,
  toneColor,
  useBarScheme,
  useColors,
} from "./tokens/colors.js";

export { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";

export { MARK_SIZE, SPACE } from "./tokens/space.js";

export { BAR_TITLE, TYPE_ROLE } from "./tokens/type.js";

export {
  AgentTranscript,
  type MessageItem,
  type OlderPages,
  type TranscriptReveal,
} from "./transcript.js";

export {
  drawnCallIds,
  managerChatItems,
  managerThreadItems,
  NO_TOGGLES,
  openCuts,
  rowsNear,
  type SaidFile,
  type ShownFile,
  shownFiles,
  shownMediaIds,
  shownPictureIds,
  shownRecordingIds,
  TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptToggles,
  toggledAt,
  transcriptItems,
  transcriptOriginOf,
  withSending,
  withWaitingLine,
} from "./transcript-model.js";

export { type UndeliveredLine, UndeliveredMark } from "./undelivered-mark.js";

export {
  ASYNC_ACTION_STAGE,
  type AsyncAction,
  type AsyncActionAct,
  type AsyncActionStage,
  type AsyncActionState,
  rejectionWords,
  useAsyncAction,
} from "./use-async-action.js";

export { useWindowSizeClass } from "./use-window-size-class.js";

export { Video } from "./video.js";

export {
  WINDOW_SIZE_CLASS,
  type WindowSizeClass,
  windowSizeClass,
} from "./window-size-class.js";

export {
  newWorkspaceAction,
  SWITCHER_LOOK,
  type SwitcherAccount,
  type SwitcherAction,
  type SwitcherLook,
  WorkspaceSwitcher,
  WorkspaceSwitcherItem,
} from "./workspace-switcher.js";

export { type SwitcherWorkspace, WorkspaceTile } from "./workspace-tile.js";
