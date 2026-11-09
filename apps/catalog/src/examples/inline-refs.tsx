import {
  DocumentIcon,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  INLINE_REF_FIT,
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
  InlineRefFitScope,
  SubjectLine,
  Text,
  UserIcon,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * inline-refs.tsx -- things named in a line of words: a link's words, a
 * byline's wash, and a mention's pill, each pressable and not; a pill
 * saying where its subject stands, one that leaves the app as a link, one
 * whose subject is gone, all in running words that they wrap across as the
 * words do; long names wrapping in a narrow column, each glyph kept to its
 * name's first word, and a short name never parted from its glyph or its
 * standing there; the same long names in a slot one line tall, fading out
 * where they are cut, a path at its start;
 * and a pill as the subject of a line, as wide as its name until the line
 * runs out. A screen reader hears each pill's kind before its name. Each hangs its card, or
 * its name in a pill, in the window's tooltip, once the pointer rests on
 * it or the keyboard reaches it.
 */

const TASK_CARD = (
  <HoverCard>
    <HoverCardHead glyph={<DocumentIcon />} name="Teammate invitations" sub="acme/relay" />
    <HoverCardNote>
      Expire an invitation after a week, and let its sender send it again.
    </HoverCardNote>
  </HoverCard>
);

/** Nothing happens on a press: the catalog opens nowhere. */
function press(): void {}

function InlineRefs(): React.JSX.Element {
  return (
    <InlineRefFitScope fit={INLINE_REF_FIT.FLOW}>
      <CatalogSection id="inline-ref-link" title="Link">
        <Text>
          Opened{" "}
          <InlineRef
            look={INLINE_REF_LOOK.LINK}
            glyph={<DocumentIcon />}
            label="packages/service/src/maintenance/maintenance-sweep.ts"
            name={INLINE_REF_NAME.PATH}
            state="12–40"
            onPress={press}
          />{" "}
          and{" "}
          <InlineRef
            look={INLINE_REF_LOOK.LINK}
            glyph={<DocumentIcon />}
            label="Teammate invitations"
            card={TASK_CARD}
          />{" "}
          beside it.
        </Text>
      </CatalogSection>
      <CatalogSection id="inline-ref-wash" title="Wash">
        <Text>
          Edited by{" "}
          <InlineRef
            look={INLINE_REF_LOOK.WASH}
            glyph={<UserIcon />}
            label="Charles Pan"
            onPress={press}
          />{" "}
          on{" "}
          <InlineRef
            look={INLINE_REF_LOOK.WASH}
            glyph={<UserIcon />}
            label="Lee Park"
            heard=" (former member)"
          />
          ’s call.
        </Text>
      </CatalogSection>
      <CatalogSection id="inline-ref-pill" title="Pill">
        <Text>
          See{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            label="Teammate invitations"
            onPress={press}
            card={TASK_CARD}
          />
          , its issue{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            kind="issue"
            label="Invitations expire too soon"
            state="In progress"
            onPress={press}
            linkHref="https://linear.app/acme/issue/REL-42"
            leaves
          />
          , and the section{" "}
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            kind="section"
            label="Old rollout"
            gone
            onPress={press}
          />{" "}
          it no longer holds, or the skill{" "}
          <InlineRef look={INLINE_REF_LOOK.PILL} kind="skill" label="/release" onPress={press} />.
        </Text>
      </CatalogSection>
      <CatalogSection id="inline-ref-narrow" title="Long names in a narrow column">
        <div className="catalog-column">
          <Text>
            Move{" "}
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              label="Move every scheduled automation onto the workspace's own timezone"
              onPress={press}
            />{" "}
            after{" "}
            <InlineRef
              look={INLINE_REF_LOOK.LINK}
              glyph={<DocumentIcon />}
              label="apps/desktop/src/renderer/tasks/a-very-long-folder-name/inline-ref.tsx"
              name={INLINE_REF_NAME.PATH}
              state="4–9"
              onPress={press}
            />
            , then push it to its pull request{" "}
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              kind="pull request"
              label="#7889"
              state="Open"
              onPress={press}
            />{" "}
            and ship it.
          </Text>
        </div>
      </CatalogSection>
      <CatalogSection id="inline-ref-one-line" title="Long names on one line">
        <InlineRefFitScope fit={INLINE_REF_FIT.LINE}>
          <div className="catalog-column">
            <Text>
              <InlineRef
                look={INLINE_REF_LOOK.PILL}
                glyph={<DocumentIcon />}
                label="Move every scheduled automation onto the workspace's own timezone"
                onPress={press}
              />
            </Text>
            <Text>
              <InlineRef
                look={INLINE_REF_LOOK.LINK}
                glyph={<DocumentIcon />}
                label="apps/desktop/src/renderer/tasks/a-very-long-folder-name/inline-ref.tsx"
                name={INLINE_REF_NAME.PATH}
                state="4–9"
                onPress={press}
              />
            </Text>
          </div>
        </InlineRefFitScope>
      </CatalogSection>
      <CatalogSection id="inline-ref-subject" title="The subject of a line">
        <div className="catalog-column">
          <SubjectLine lead="Thread answer">
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              label="Expire an invitation after a week?"
              onPress={press}
            />
          </SubjectLine>
          <SubjectLine lead="Thread message">
            <InlineRef
              look={INLINE_REF_LOOK.PILL}
              glyph={<DocumentIcon />}
              label="Move every scheduled automation onto the workspace's own timezone"
              onPress={press}
            />
          </SubjectLine>
        </div>
      </CatalogSection>
    </InlineRefFitScope>
  );
}

export const INLINE_REFS_EXAMPLE: Example = {
  id: "inline-refs",
  title: "Inline references",
  Render: InlineRefs,
};
