// Rechtsklick im Dokument-Editor.
//
// Bewusst kein Menü für jeden Rechtsklick: über einem Wort mit blinkendem
// Cursor bleibt das native Menü der WebView stehen, weil dort die
// Rechtschreibvorschläge hängen. Ein eigenes Menü gibt es nur, wo Distelfink
// etwas anzubieten hat — über markiertem Text und über einem fertigen Tag.

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { removePlanTagAt } from "./PlanTag";
import { startPlanTagForSelection } from "./planTagCommand";
import { planTagName } from "./planTagInfo";
import { PLAN_TAG_KINDS, PLAN_TAG_LABEL, PLAN_TAG_RESEARCH, type PlanTagKind } from "../planTags";
import { useStore, type PaneId } from "../store";
import type { IconName } from "./Icon";

const KIND_ICON: Record<PlanTagKind, IconName> = {
  person: "user",
  location: "map-pin",
  note: "notebook-text",
};

export function EditorContextMenu({ editor, paneId }: { editor: Editor; paneId: PaneId }) {
  const { menu, openAt, close } = useContextMenu();
  const planIndex = useStore((s) => s.planIndex);
  const openResearchNextTo = useStore((s) => s.openResearchNextTo);

  useEffect(() => {
    const dom = editor.view.dom;

    const onContextMenu = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const tagEl = target?.closest(".plan-tag[data-plan-id]") as HTMLElement | null;
      const kind = tagEl?.getAttribute("data-plan-tag") as PlanTagKind | null;
      const id = tagEl?.getAttribute("data-plan-id") ?? null;

      // Der Klick zählt nur als "auf der Markierung", wenn er auch darin
      // liegt: daneben setzt die WebView den Cursor um, was ProseMirror erst
      // nach diesem Ereignis mitbekommt — die alte Auswahl wäre dann eine
      // Fata Morgana.
      const selection = editor.state.selection;
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      const onSelection =
        !selection.empty &&
        at !== null &&
        at.pos >= selection.from &&
        at.pos <= selection.to;

      const items: ContextMenuItem[] = [];

      if (tagEl && kind && id) {
        const name = planTagName(kind, id, planIndex);
        items.push({
          label: name ? `„${name}“ öffnen` : "Eintrag nicht gefunden",
          icon: KIND_ICON[kind],
          disabled: !name,
          hint: "Strg+Klick",
          onSelect: () => void openResearchNextTo(paneId, PLAN_TAG_RESEARCH[kind], id),
        });
        items.push({
          label: "Verknüpfung lösen",
          icon: "x",
          onSelect: () => removePlanTagAt(editor, tagEl),
        });
      }

      if (onSelection) {
        if (items.length) items.push({ kind: "separator" });
        items.push({
          kind: "submenu",
          label: "Verlinken mit",
          icon: "link-2",
          items: PLAN_TAG_KINDS.map((k) => ({
            label: PLAN_TAG_LABEL[k],
            icon: KIND_ICON[k],
            onSelect: () => startPlanTagForSelection(editor, k),
          })),
        });
        items.push({ kind: "separator" });
        items.push({
          label: "Ausschneiden",
          hint: "Strg+X",
          onSelect: () => clipboard(editor, "cut"),
        });
        items.push({
          label: "Kopieren",
          icon: "copy",
          hint: "Strg+C",
          onSelect: () => clipboard(editor, "copy"),
        });
      }

      // Nichts anzubieten → natives Menü (Rechtschreibung).
      if (!items.length) return;
      e.preventDefault();
      openAt(e.clientX, e.clientY, items);
    };

    dom.addEventListener("contextmenu", onContextMenu);
    return () => dom.removeEventListener("contextmenu", onContextMenu);
  }, [editor, paneId, planIndex, openResearchNextTo, openAt]);

  if (!menu) return null;
  return <ContextMenu {...menu} onClose={close} />;
}

/** Der Klick auf den Menüeintrag hat den Fokus geholt — erst zurückgeben,
 *  sonst schneidet die WebView aus dem Nichts aus. */
function clipboard(editor: Editor, command: "cut" | "copy") {
  editor.commands.focus();
  document.execCommand(command);
}
