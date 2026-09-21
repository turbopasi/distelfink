// Rechtsklick-Menü, das überall in der App wiederverwendet wird. Bewusst
// generisch: die Einträge baut jede Stelle selbst zusammen (der Binder kennt
// seine Aktionen, die Planung ihre) — hier steht nur, wie ein Menü aussieht,
// wo es aufgeht und wie es wieder verschwindet. Optik und Klassen sind die des
// Anwendungsmenüs (MenuBar), damit beide Menüs identisch wirken.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

/** Ein anklickbarer Eintrag. */
interface ContextMenuAction {
  kind?: "item";
  label: string;
  /** Symbol in der linken Spalte. */
  icon?: IconName;
  /** Beliebiges Zeichen links statt eines Symbols (Farb-/Statuspunkt). */
  mark?: ReactNode;
  /** Rechte Spalte (Tastenkürzel o. ä.). */
  hint?: ReactNode;
  /** Zeigt ein Häkchen rechts — für Einträge, die einen Zustand setzen. */
  checked?: boolean;
  disabled?: boolean;
  /** Löschen und Ähnliches: rot eingefärbt. */
  danger?: boolean;
  onSelect: () => void;
}

interface ContextMenuSubmenu {
  kind: "submenu";
  label: string;
  icon?: IconName;
  mark?: ReactNode;
  disabled?: boolean;
  items: ContextMenuItem[];
}

export type ContextMenuItem =
  | ContextMenuAction
  | ContextMenuSubmenu
  | { kind: "separator" };

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Zustand eines Rechtsklick-Menüs. `open` gehört an `onContextMenu`, die
 *  Einträge baut der Aufrufer für das gerade angeklickte Element. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  /** Freie Platzierung — für Knöpfe, die ein Menü aufklappen statt zu handeln. */
  const openAt = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    setMenu({ x, y, items });
  }, []);

  const open = useCallback(
    (e: ReactMouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      // Verschachtelte Zeilen (Binder-Baum): nur das innerste Element antwortet.
      e.stopPropagation();
      openAt(e.clientX, e.clientY, items);
    },
    [openAt],
  );

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, openAt, close };
}

/** Klappt ein Menü unter einem Knopf auf, linksbündig zu ihm. */
export function openBelow(
  e: ReactMouseEvent<HTMLElement>,
  items: ContextMenuItem[],
  openAt: (x: number, y: number, items: ContextMenuItem[]) => void,
) {
  const rect = e.currentTarget.getBoundingClientRect();
  openAt(rect.left, rect.bottom + 4, items);
}

/** Rand zum Fenster, damit das Menü nie an der Kante klebt. */
const EDGE = 4;

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuState & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Nach dem ersten Zeichnen ins Fenster klemmen — vorher ist die Größe des
  // Menüs unbekannt (die Einträge bestimmen sie).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
  }, [x, y, items]);

  // Bewusst ohne Fangflaeche über dem Fenster (anders als die Menüleiste):
  // so trifft der nächste Rechtsklick gleich die Zeile darunter, statt nur das
  // offene Menü wegzuklicken.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Escape schließt, bevor der globale Handler den Fokusmodus trifft.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    // Beim Scrollen bliebe das Menü sonst neben der Zeile hängen.
    const onWheel = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [onClose]);

  // Direkt am body: sonst läge das Menü in der Stapelebene seines Aufrufers
  // (z. B. einer Zeitstrahl-Karte), und was im DOM danach kommt, schöbe sich
  // über ein ausklappendes Untermenü.
  return createPortal(
    <div
      ref={ref}
      className="menu-popover context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
    >
      <ItemList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

function ItemList({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((item, i) => {
        if (item.kind === "separator") return <hr key={i} />;
        if (item.kind === "submenu") {
          return <Submenu key={i} item={item} onClose={onClose} />;
        }
        return (
          <button
            key={i}
            className={item.danger ? "menu-item danger" : "menu-item"}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <Mark item={item} />
            <span className="menu-item-label">{item.label}</span>
            {(item.hint || item.checked) && (
              <span className="menu-item-hint">
                {item.hint ?? <Icon name="check" size={14} />}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

/** Linke Spalte: eigenes Zeichen, Symbol — oder leer, damit alles bündig steht. */
function Mark({ item }: { item: ContextMenuAction | ContextMenuSubmenu }) {
  return (
    <span className="menu-item-icon">
      {item.mark ?? (item.icon && <Icon name={item.icon} size={14} />)}
    </span>
  );
}

/** Klappt zur Seite auf (Status, Farbe) und weicht dem Fensterrand aus. */
function Submenu({ item, onClose }: { item: ContextMenuSubmenu; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next: CSSProperties = {};
    // Kein Platz rechts? Dann nach links aufklappen.
    if (rect.right > window.innerWidth - EDGE) {
      next.left = "auto";
      next.right = "100%";
    }
    const overflowY = rect.bottom - (window.innerHeight - EDGE);
    if (overflowY > 0) next.marginTop = `-${Math.ceil(overflowY)}px`;
    setStyle(next);
  }, [open, item.items]);

  return (
    <span
      className="menu-sub"
      onMouseEnter={() => !item.disabled && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="menu-item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={item.disabled}
        onClick={() => setOpen(!open)}
      >
        <Mark item={item} />
        <span className="menu-item-label">{item.label}</span>
        <span className="menu-item-hint">
          <Icon name="chevron-right" size={14} />
        </span>
      </button>
      {open && (
        <div ref={ref} className="menu-popover menu-popover-sub" role="menu" style={style}>
          <ItemList items={item.items} onClose={onClose} />
        </div>
      )}
    </span>
  );
}
