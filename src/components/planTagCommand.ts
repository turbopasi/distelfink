// Slash-Kommando für Planungs-Tags: "/person " öffnet ein Suchfeld, die Auswahl
// eröffnet einen leeren Tag an der Cursorposition, das Getippte wandert hinein,
// ENTER schließt ihn ab.
//
// Der Tag entsteht bewusst leer — welches Wort drinsteht ("Er", "Seine",
// "der Mann"), hängt am Satz. Solange geschrieben wird, trägt dieses Plugin den
// Mark laufend nach (appendTransaction); der Mark selbst ist `inclusive: false`,
// damit der Tag nach dem Abschließen nicht weiterwächst.
//
// Zweiter Weg zum selben Suchfeld: markierter Text, Rechtsklick, „Verlinken
// mit“ (siehe EditorContextMenu). Dort steht das Label schon fest — die
// Auswahl im Suchfeld setzt den Mark sofort über die Markierung.

import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { PLAN_TAG_MARK } from "./PlanTag";
import { PLAN_TAG_KINDS, type PlanTagKind } from "../planTags";

export type PlanTagCommandState =
  /** Suchfeld offen, es ist noch nichts im Dokument passiert.
   *  `to` gesetzt = bereits markierter Text wird verlinkt (Rechtsklick-Menü),
   *  statt den Tag leer zu eröffnen und das Label erst zu tippen. */
  | { phase: "picker"; kind: PlanTagKind; from: number; to?: number }
  /** Tag eröffnet, das Label wird gerade getippt. */
  | { phase: "compose"; kind: PlanTagKind; id: string; name: string; from: number }
  | null;

export const planTagCommandKey = new PluginKey<PlanTagCommandState>("planTagCommand");

export function getPlanTagCommandState(state: EditorState): PlanTagCommandState {
  return planTagCommandKey.getState(state) ?? null;
}

const TRIGGER = new RegExp(`/(${PLAN_TAG_KINDS.join("|")})$`);

/** Vor dem Kommando muss ein Wortende stehen — "und/person" soll nicht auslösen. */
function triggerAllowed(state: EditorState, start: number): boolean {
  if (start <= 0) return true;
  const before = state.doc.textBetween(Math.max(0, start - 1), start, "\n", "\n");
  return before === "" || /\s/.test(before);
}

function decorations(state: EditorState): DecorationSet {
  const value = getPlanTagCommandState(state);
  // Markierter Text, während das Suchfeld den Fokus hat: die Auswahl des
  // Browsers ist dann unsichtbar — sie muss sichtbar bleiben, damit klar ist,
  // welche Wörter der Tag umfasst.
  if (value?.phase === "picker") {
    if (value.to === undefined || value.to <= value.from) return DecorationSet.empty;
    return DecorationSet.create(state.doc, [
      Decoration.inline(value.from, value.to, { class: "plan-tag-selection" }),
    ]);
  }
  if (!value || value.phase !== "compose") return DecorationSet.empty;
  const head = state.selection.head;
  if (head > value.from) {
    return DecorationSet.create(state.doc, [
      Decoration.inline(value.from, head, { class: "plan-tag-composing" }),
    ]);
  }
  // Noch nichts getippt: die leere Pille als Platzhalter zeigen.
  const widget = Decoration.widget(
    value.from,
    () => {
      const el = document.createElement("span");
      el.className = "plan-tag plan-tag-empty";
      el.setAttribute("data-plan-tag", value.kind);
      return el;
    },
    { side: -1 },
  );
  return DecorationSet.create(state.doc, [widget]);
}

function planTagCommandPlugin() {
  return new Plugin<PlanTagCommandState>({
    key: planTagCommandKey,

    state: {
      init: () => null,
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(planTagCommandKey) as
          | PlanTagCommandState
          | undefined;
        if (meta !== undefined) return meta;
        if (!value) return null;

        const from = tr.mapping.map(value.from, -1);

        if (value.phase === "picker") {
          // Der Fokus liegt im Suchfeld; alles, was am Dokument passiert,
          // kommt von außen und beendet das Kommando.
          if (tr.docChanged) return null;
          if (value.to === undefined) return { ...value, from };
          return { ...value, from, to: tr.mapping.map(value.to, 1) };
        }

        const selection = newState.selection;
        // Cursor hinter den Tag-Anfang zurückgelaufen oder Bereich markiert →
        // das Label ist fertig.
        if (!selection.empty || selection.head < from) return null;
        if (selection.$head.parent !== newState.doc.resolve(from).parent) return null;
        return { ...value, from };
      },
    },

    // Getipptes Label nachträglich mit dem Mark versehen. Ein `inclusive`
    // Mark würde beim Abschließen am Rand weiterlaufen, stored marks gehen
    // beim Fokuswechsel zum Suchfeld verloren — deshalb explizit.
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const value = getPlanTagCommandState(newState);
      if (!value || value.phase !== "compose") return null;
      const to = newState.selection.head;
      if (to <= value.from) return null;

      const type = newState.schema.marks[PLAN_TAG_MARK];
      if (!type) return null;
      const mark = type.create({ kind: value.kind, id: value.id });
      let missing = false;
      newState.doc.nodesBetween(value.from, to, (node) => {
        if (node.isText && !mark.isInSet(node.marks)) missing = true;
      });
      if (!missing) return null;
      return newState.tr.addMark(value.from, to, mark);
    },

    props: {
      decorations,

      handleTextInput(view, from, _to, text) {
        if (text !== " " || getPlanTagCommandState(view.state)) return false;
        const context = view.state.doc.textBetween(
          Math.max(0, from - 12),
          from,
          "\n",
          "\n",
        );
        const match = TRIGGER.exec(context);
        if (!match) return false;
        const start = from - match[0].length;
        if (!triggerAllowed(view.state, start)) return false;

        // Kommandotext entfernen und das Leerzeichen schlucken.
        const tr = view.state.tr.delete(start, from);
        tr.setMeta(planTagCommandKey, {
          phase: "picker",
          kind: match[1] as PlanTagKind,
          from: start,
        });
        view.dispatch(tr);
        return true;
      },
    },
  });
}

/** Öffnet das Suchfeld für bereits markierten Text (Rechtsklick → Verlinken). */
export function startPlanTagForSelection(editor: Editor, kind: PlanTagKind): boolean {
  const { from, to } = editor.state.selection;
  if (from >= to) return false;
  const tr = editor.state.tr.setMeta(planTagCommandKey, {
    phase: "picker",
    kind,
    from,
    to,
  });
  editor.view.dispatch(tr);
  return true;
}

/** Übernimmt die Auswahl aus dem Suchfeld: markierter Text wird sofort
 *  getaggt, sonst eröffnet sich der leere Tag zum Tippen des Labels. */
export function choosePlanTagTarget(editor: Editor, id: string, name: string) {
  const value = getPlanTagCommandState(editor.state);
  if (!value || value.phase !== "picker") return;
  const { kind, from, to } = value;
  editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        if (to !== undefined && to > from) {
          const type = tr.doc.type.schema.marks[PLAN_TAG_MARK];
          if (type) tr.addMark(from, to, type.create({ kind, id }));
          tr.setSelection(TextSelection.create(tr.doc, to));
          tr.setMeta(planTagCommandKey, null);
        } else {
          tr.setSelection(TextSelection.create(tr.doc, from));
          tr.setMeta(planTagCommandKey, { phase: "compose", kind, id, name, from });
        }
      }
      return true;
    })
    .run();
}

/** Bricht ab und stellt den getippten Kommandotext wieder her. */
export function cancelPlanTagCommand(editor: Editor) {
  const value = getPlanTagCommandState(editor.state);
  if (!value) return;
  editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        // Nur das getippte Kommando wiederherstellen — beim Rechtsklick-Weg
        // stand nie etwas im Text.
        if (value.phase === "picker" && value.to === undefined) {
          tr.insertText(`/${value.kind} `, value.from);
        }
        tr.setMeta(planTagCommandKey, null);
      }
      return true;
    })
    .run();
}

/** Schließt den Tag ab; ohne getipptes Label springt der Name der Auswahl ein. */
export function finishPlanTagCompose(editor: Editor): boolean {
  const value = getPlanTagCommandState(editor.state);
  if (!value || value.phase !== "compose") return false;
  const head = editor.state.selection.head;
  editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        if (head === value.from) {
          const type = tr.doc.type.schema.marks[PLAN_TAG_MARK];
          const mark = type?.create({ kind: value.kind, id: value.id });
          tr.insertText(value.name, value.from);
          if (mark) tr.addMark(value.from, value.from + value.name.length, mark);
          tr.setSelection(
            TextSelection.create(tr.doc, value.from + value.name.length),
          );
        }
        tr.setMeta(planTagCommandKey, null);
      }
      return true;
    })
    .focus()
    .run();
  return true;
}

export const PlanTagCommand = Extension.create({
  name: "planTagCommand",

  // Vor den Enter-Handlern des StarterKits.
  priority: 1200,

  addKeyboardShortcuts() {
    return {
      Enter: () => finishPlanTagCompose(this.editor),
      Escape: () => {
        const value = getPlanTagCommandState(this.editor.state);
        if (!value) return false;
        // Mit bereits getipptem Label wie ENTER — der Text bleibt getaggt.
        if (value.phase === "compose" && this.editor.state.selection.head > value.from) {
          return finishPlanTagCompose(this.editor);
        }
        cancelPlanTagCommand(this.editor);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [planTagCommandPlugin()];
  },
});
