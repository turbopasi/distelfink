import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { loadEntities } from "../entityLists";
import {
  PANE_IDS,
  showsMindboard,
  showsResearch,
  useStore,
  type PaneResearchKind,
} from "../store";
import { RESEARCH_KIND_LABELS } from "./ResearchPane";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Icon, type IconName } from "./Icon";
import { startLocationDrag, startPersonDrag } from "./drag";

const KIND_ICON: Record<PaneResearchKind, IconName> = {
  characters: "user",
  locations: "map-pin",
};

type StoreState = ReturnType<typeof useStore.getState>;

/** Planungsmodul: eigenständiges Werkzeug ohne Einträge-Liste (anders als
 *  Personen/Orte). Hier kommen künftige Module dazu — Plotstruktur,
 *  Beziehungen, Weltenbau —, jedes zeigt sich im aktiven Bereich. */
interface PlanningModule {
  id: string;
  icon: string;
  label: string;
  /** Wird das Modul gerade in einem Bereich angezeigt? */
  isOpen: (s: StoreState) => boolean;
  toggle: (s: StoreState, on: boolean) => void;
}

const PLANNING_MODULES: PlanningModule[] = [
  {
    id: "timeline",
    icon: "🕘",
    label: "Zeitstrahl",
    isOpen: (s) => PANE_IDS.some((p) => s.panes[p].overlay?.kind === "timeline"),
    toggle: (s, on) => {
      const pane = PANE_IDS.find((p) => s.panes[p].overlay?.kind === "timeline") ?? s.activePane;
      void s.setPaneOverlay(pane, on ? { kind: "timeline" } : null);
    },
  },
];

/** Zweite Sidebar neben dem Binder: Personen, Orte und Planungsmodule. */
export function ResearchSidebar() {
  return (
    <nav className="research-sidebar sidebar">
      <div className="binder-header">
        <span>Planung</span>
      </div>
      <ResearchGroup kind="characters" />
      <ResearchGroup kind="locations" />
      <ModuleGroup />
      <MindboardGroup />
    </nav>
  );
}

function ModuleGroup() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="research-group">
      <div className="research-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="disclosure">
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        </span>
        <span>Module</span>
      </div>
      {!collapsed && (
        <ul className="research-group-list">
          {PLANNING_MODULES.map((m) => (
            <ModuleItem key={m.id} module={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ModuleItem({ module }: { module: PlanningModule }) {
  const isOpen = useStore(module.isOpen);
  return (
    <li
      className={isOpen ? "open" : ""}
      title={isOpen ? `${module.label} schließen` : `${module.label} im aktiven Bereich öffnen`}
      onClick={() => module.toggle(useStore.getState(), !isOpen)}
    >
      <span className="item-name">
        {module.icon} {module.label}
      </span>
    </li>
  );
}

function ResearchGroup({ kind }: { kind: PaneResearchKind }) {
  const researchVersion = useStore((s) => s.researchVersion);
  const touchResearch = useStore((s) => s.touchResearch);
  const projectRoot = useStore((s) => s.project?.root);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    // Über den gemeinsamen Cache: der Recherche-Bereich zeigt die Einträge
    // dann ohne eigene Wartezeit.
    void loadEntities(projectRoot, kind)
      .then((l) => alive && setItems(l.map((e) => ({ id: e.id, name: e.name }))))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [kind, researchVersion, projectRoot]);

  const labels = RESEARCH_KIND_LABELS[kind];

  async function addItem() {
    try {
      const created = await api.saveEntity(kind, {
        id: "",
        name: labels.fresh,
      });
      const createdId = created.id;
      touchResearch();
      setCollapsed(false);
      if (createdId) {
        const s = useStore.getState();
        void s.openResearchInPane(s.activePane, kind, createdId);
      }
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  return (
    <div className="research-group">
      <div className="research-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="disclosure">
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        </span>
        <span>{labels.plural}</span>
        <button
          title={labels.add}
          onClick={(e) => {
            e.stopPropagation();
            void addItem();
          }}
        >
          +
        </button>
      </div>
      {!collapsed && (
        <ul className="research-group-list">
          {items.length === 0 && <li className="muted small empty">Keine Einträge</li>}
          {items.map((it) => (
            <ResearchItem key={it.id} kind={kind} id={it.id} name={it.name} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResearchItem({ kind, id, name }: { kind: PaneResearchKind; id: string; name: string }) {
  const isOpen = useStore((s) =>
    PANE_IDS.some((p) => showsResearch(s.panes[p], kind, id)),
  );
  const touchResearch = useStore((s) => s.touchResearch);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const open = () => {
    const s = useStore.getState();
    void s.openResearchInPane(s.activePane, kind, id);
  };

  function startRename() {
    setDraft(name);
    setEditing(true);
  }

  // Umbenannt wird hier in der Liste — ein kurzer Weg neben dem Namensfeld
  // des Eintrags.
  function commitRename() {
    setEditing(false);
    const title = draft.trim();
    if (!title || title === name) {
      setDraft(name);
      return;
    }
    void api
      .updateEntityMeta(kind, id, { name: title })
      .then(() => touchResearch())
      .catch((e) => useStore.setState({ error: String(e) }));
  }

  function duplicate() {
    void api
      .duplicateEntity(kind, id)
      .then(() => touchResearch())
      .catch((e) => useStore.setState({ error: String(e) }));
  }

  const menuItems = (): ContextMenuItem[] => [
    { label: "Umbenennen", icon: "pencil", onSelect: startRename },
    { label: "Duplizieren", icon: "copy", onSelect: duplicate },
    { kind: "separator" },
    { label: "Löschen", icon: "trash-2", danger: true, onSelect: () => void confirmDelete() },
  ];

  async function confirmDelete() {
    const label = RESEARCH_KIND_LABELS[kind].singular;
    const yes = await ask(`${label} "${name}" löschen? (wandert in den Papierkorb des Projekts)`, {
      title: "Löschen",
      kind: "warning",
    });
    if (!yes) return;
    try {
      await api.deleteEntity(kind, id);
      // Panes leeren, die den gelöschten Eintrag zeigen.
      const s = useStore.getState();
      for (const p of PANE_IDS) {
        if (showsResearch(s.panes[p], kind, id)) {
          s.setPaneResearchId(p, null);
        }
      }
      touchResearch();
      s.touchTrash();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  return (
    <li
      className={`${isOpen ? "open" : ""} ${menu ? "menu-open" : ""}`}
      // Personen und Orte lassen sich auf Ereignisse im Zeitstrahl ziehen.
      draggable={(kind === "characters" || kind === "locations") && !editing}
      onDragStart={(e) =>
        kind === "characters" ? startPersonDrag(e, id) : startLocationDrag(e, id)
      }
      onClick={open}
      onDoubleClick={startRename}
      onContextMenu={(e) => !editing && openMenu(e, menuItems())}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="item-name">
            <Icon name={KIND_ICON[kind]} size={14} />
            {name}
          </span>
          <button
            className="row-delete"
            title="Löschen"
            onClick={(e) => {
              e.stopPropagation();
              void confirmDelete();
            }}
          >
            <Icon name="trash-2" size={14} />
          </button>
        </>
      )}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </li>
  );
}

/** Mindboards: freie Brainstorming-Flächen, beliebig viele pro Projekt. */
function MindboardGroup() {
  const version = useStore((s) => s.mindboardVersion);
  const projectRoot = useStore((s) => s.project?.root);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .listMindboards()
      .then((l) => alive && setItems(l))
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      alive = false;
    };
  }, [version, projectRoot]);

  async function addBoard() {
    try {
      const created = await api.createMindboard("Neues Mindboard");
      const s = useStore.getState();
      s.touchMindboards();
      setCollapsed(false);
      void s.setPaneOverlay(s.activePane, { kind: "mindboard", id: created.id });
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  return (
    <div className="research-group">
      <div className="research-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="disclosure">
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
        </span>
        <span>Mindboards</span>
        <button
          title="Neues Mindboard anlegen"
          onClick={(e) => {
            e.stopPropagation();
            void addBoard();
          }}
        >
          +
        </button>
      </div>
      {!collapsed && (
        <ul className="research-group-list">
          {items.length === 0 && <li className="muted small empty">Keine Mindboards</li>}
          {items.map((it) => (
            <MindboardItem key={it.id} id={it.id} name={it.name} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MindboardItem({ id, name }: { id: string; name: string }) {
  const isOpen = useStore((s) => PANE_IDS.some((p) => showsMindboard(s.panes[p], id)));
  const touchMindboards = useStore((s) => s.touchMindboards);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const open = () => {
    const s = useStore.getState();
    void s.setPaneOverlay(s.activePane, { kind: "mindboard", id });
  };

  function startRename() {
    setDraft(name);
    setEditing(true);
  }

  function commitRename() {
    setEditing(false);
    const title = draft.trim();
    if (!title || title === name) {
      setDraft(name);
      return;
    }
    void api
      .renameMindboard(id, title)
      .then(() => touchMindboards())
      .catch((e) => useStore.setState({ error: String(e) }));
  }

  async function confirmDelete() {
    const yes = await ask(`Mindboard "${name}" endgültig löschen?`, {
      title: "Löschen",
      kind: "warning",
    });
    if (!yes) return;
    try {
      // Erst schließen, damit das Board beim Aushängen nicht neu gespeichert wird.
      const s = useStore.getState();
      for (const p of PANE_IDS) {
        if (showsMindboard(s.panes[p], id)) await s.setPaneOverlay(p, null);
      }
      await api.deleteMindboard(id);
      touchMindboards();
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  }

  const menuItems = (): ContextMenuItem[] => [
    { label: "Umbenennen", icon: "pencil", onSelect: startRename },
    { kind: "separator" },
    { label: "Löschen", icon: "trash-2", danger: true, onSelect: () => void confirmDelete() },
  ];

  return (
    <li
      className={`${isOpen ? "open" : ""} ${menu ? "menu-open" : ""}`}
      onClick={open}
      onDoubleClick={startRename}
      onContextMenu={(e) => !editing && openMenu(e, menuItems())}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="item-name">
            <Icon name="workflow" size={14} />
            {name}
          </span>
          <button
            className="row-delete"
            title="Löschen"
            onClick={(e) => {
              e.stopPropagation();
              void confirmDelete();
            }}
          >
            <Icon name="trash-2" size={14} />
          </button>
        </>
      )}
      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </li>
  );
}
