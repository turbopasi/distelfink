import { useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PANE_IDS, PANES_FOR_MODE, useStore, type PaneId } from "./store";
import { eventToCombo, SHORTCUT_ACTIONS } from "./settings";
import { StartScreen } from "./components/StartScreen";
import { Binder } from "./components/Binder";
import { RichEditor } from "./components/RichEditor";
import { Corkboard } from "./components/Corkboard";
import { QuickNav } from "./components/QuickNav";
import { TimelinePanel } from "./components/TimelinePanel";
import { TrashPanel } from "./components/TrashPanel";
import { ResearchPane } from "./components/ResearchPane";
import { ResearchSidebar } from "./components/ResearchSidebar";
import { LayoutMenu } from "./components/LayoutMenu";
import { MenuBar } from "./components/MenuBar";
import { Icon } from "./components/Icon";
import { HistoryOverlay } from "./components/HistoryPanel";
import { ExportOverlay } from "./components/ExportDialog";
import { SettingsOverlay } from "./components/SettingsDialog";
import { AboutOverlay } from "./components/AboutDialog";
import { UpdateBanner } from "./components/UpdateBanner";
import "./App.css";

function App() {
  const project = useStore((s) => s.project);
  const focusMode = useStore((s) => s.focusMode);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);

  // Externe Änderungen beim Fokussieren prüfen; beim Defokussieren speichern.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      const s = useStore.getState();
      if (focused) void s.checkExternalChanges();
      else void s.flushAll();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // Gespeicherte Einstellungen (Theme, Editor, Layout, Kürzel) einmalig laden.
  useEffect(() => {
    void useStore.getState().initSettings();
  }, []);

  // Globale Shortcuts — Belegung kommt aus den Einstellungen (Phase 7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (e.key === "Escape") {
        if (s.aboutOpen) s.setAboutOpen(false);
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.exportOpen) s.setExportOpen(false);
        else if (s.historyFor) s.setHistoryFor(null);
        else if (s.quickNavOpen) s.setQuickNavOpen(false);
        else if (s.focusMode) s.setFocusMode(false);
        return;
      }
      // Bereits verarbeitete Events (z. B. Editor-Befehle) nicht doppelt auslösen.
      if (e.defaultPrevented) return;
      const combo = eventToCombo(e);
      if (!combo) return;
      // Kürzel ohne Strg/Alt nicht beim Tippen in Feldern auslösen.
      if (!e.ctrlKey && !e.altKey && isTypingTarget(e.target)) return;
      const actionId = SHORTCUT_ACTIONS.find((a) => s.settings.shortcuts[a.id] === combo)?.id;
      if (!actionId) return;

      const actions: Record<string, () => void> = {
        focusMode: () => s.toggleFocusMode(),
        quickNav: () => {
          if (s.project) s.setQuickNavOpen(!s.quickNavOpen);
        },
        toggleSplit: () => {
          if (s.project) void s.cycleLayout();
        },
        toggleBinder: () =>
          s.updateSettings({
            layout: { ...s.settings.layout, binderVisible: !s.settings.layout.binderVisible },
          }),
        toggleResearchSidebar: () =>
          s.updateSettings({
            layout: { ...s.settings.layout, researchVisible: !s.settings.layout.researchVisible },
          }),
        snapshot: () => {
          if (s.project) void s.takeSnapshot("Manueller Sicherungspunkt");
        },
        export: () => {
          if (s.project) s.setExportOpen(true);
        },
        settings: () => s.setSettingsOpen(!s.settingsOpen),
      };
      e.preventDefault();
      actions[actionId]?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ebene C: automatischer Sicherungspunkt alle 10 Minuten (Backend
  // committet nur, wenn sich seit dem letzten tatsächlich etwas geändert hat).
  useEffect(() => {
    const timer = setInterval(() => void useStore.getState().takeSnapshot(), 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={`app ${focusMode ? "focus-mode" : ""}`}>
      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={clearError}>OK</button>
        </div>
      )}
      {PANE_IDS.map((id) => (
        <ConflictBanner key={id} paneId={id} />
      ))}
      <ExternalChangesBanner />
      {project && <UpdateBanner />}
      <QuickNav />
      <HistoryOverlay />
      <ExportOverlay />
      <SettingsOverlay />
      <AboutOverlay />
      {project ? (
        <MainView />
      ) : (
        <>
          <StartScreen />
          {/* Obere Leiste des Startbildschirms: Updatehinweis links, Einstellungen
              rechts. Beide liegen in derselben Zeile, damit der Hinweis den Knopf
              nicht unterläuft. Die Leiste selbst lässt Klicks durch. */}
          <div className="start-topbar">
            <UpdateBanner floating />
            <button
              className="settings-float"
              title="Einstellungen (Strg+,)"
              onClick={() => useStore.getState().setSettingsOpen(true)}
            >
              <Icon name="settings" />
              Einstellungen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** true, wenn das Event aus einem Eingabefeld/Editor stammt. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function MainView() {
  const project = useStore((s) => s.project)!;
  const layoutMode = useStore((s) => s.layoutMode);
  const closeProject = useStore((s) => s.closeProject);
  const toggleFocusMode = useStore((s) => s.toggleFocusMode);
  const takeSnapshot = useStore((s) => s.takeSnapshot);
  const snapshotNotice = useStore((s) => s.snapshotNotice);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const binderVisible = useStore((s) => s.settings.layout.binderVisible);
  const researchVisible = useStore((s) => s.settings.layout.researchVisible);
  const updateSettings = useStore((s) => s.updateSettings);

  const toggleBinder = () => {
    const lay = useStore.getState().settings.layout;
    updateSettings({ layout: { ...lay, binderVisible: !lay.binderVisible } });
  };
  const toggleResearch = () => {
    const lay = useStore.getState().settings.layout;
    updateSettings({ layout: { ...lay, researchVisible: !lay.researchVisible } });
  };

  return (
    <div className="main-layout">
      <MenuBar />
      <header className="titlebar">
        <span className="project-title">{project.meta.title}</span>
        <span className="muted small">{project.root}</span>
        {/* Gruppe 1: was rundherum sichtbar ist. */}
        <div className="titlebar-group">
          <button
            className={binderVisible ? "on" : ""}
            title="Binder ein-/ausblenden"
            onClick={toggleBinder}
          >
            <Icon name="panel-left" />
            Binder
          </button>
          <button
            className={researchVisible ? "on" : ""}
            title="Planungsleiste (Personen, Orte, Module) ein-/ausblenden"
            onClick={toggleResearch}
          >
            <Icon name="notebook-pen" />
            Planung
          </button>
          <LayoutMenu />
          <button title="Fokusmodus" onClick={toggleFocusMode}>
            <Icon name="maximize" />
            Fokus
          </button>
        </div>
        {/* Gruppe 2: Projektaktionen. */}
        <div className="titlebar-group">
          <button
            title="Manuskript als DOCX, PDF, ePub, Markdown oder Text exportieren"
            onClick={() => setExportOpen(true)}
          >
            <Icon name="book-open" />
            Exportieren
          </button>
          {snapshotNotice && <span className="small snapshot-notice">{snapshotNotice}</span>}
          <button
            title="Aktuellen Stand des ganzen Projekts im Verlauf sichern"
            onClick={() => void takeSnapshot("Manueller Sicherungspunkt")}
          >
            <Icon name="camera" />
            Sicherungspunkt
          </button>
          <button
            className="icon-button"
            title="Einstellungen (Strg+,)"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
          {/* Bewusst mit Text: ein blankes × in der Titelleiste liest sich als
              „Fenster schließen", nicht als „Projekt schließen". */}
          <button onClick={() => void closeProject()}>Projekt schließen</button>
        </div>
      </header>
      <div className="panes">
        <SidebarStack side="left" />
        <div className="pane-grid" data-mode={layoutMode}>
          {PANES_FOR_MODE[layoutMode].map((id) => (
            <div key={id} className="pane-cell" style={{ gridArea: id }}>
              <PaneView paneId={id} />
            </div>
          ))}
        </div>
        <SidebarStack side="right" />
      </div>
    </div>
  );
}

/** Sidebars einer Seite in fester Reihenfolge: Binder außen, Planung innen.
 *  Jeder Resizer sitzt an der Innenkante seiner Sidebar. */
function SidebarStack({ side }: { side: "left" | "right" }) {
  const layout = useStore((s) => s.settings.layout);
  const binderHere = layout.binderVisible && layout.binderPosition === side;
  const researchHere = layout.researchVisible && layout.researchPosition === side;
  if (!binderHere && !researchHere) return null;

  const binder = binderHere && (
    <div className={`sidebar-slot sidebar--${side}`} key="binder">
      <Binder />
    </div>
  );
  const research = researchHere && (
    <div className={`sidebar-slot sidebar--${side}`} key="research">
      <ResearchSidebar />
    </div>
  );
  const binderResizer = binderHere && (
    <SidebarResizer key="binder-r" side={side} widthKey="binderWidth" />
  );
  const researchResizer = researchHere && (
    <SidebarResizer key="research-r" side={side} widthKey="researchWidth" />
  );

  return side === "left" ? (
    <>
      {binder}
      {binderResizer}
      {research}
      {researchResizer}
    </>
  ) : (
    <>
      {researchResizer}
      {research}
      {binderResizer}
      {binder}
    </>
  );
}

/** Trennsteg zum Verstellen einer Sidebar-Breite per Drag (delta-basiert,
 *  funktioniert daher auch mit zwei gestapelten Sidebars auf einer Seite). */
function SidebarResizer({
  side,
  widthKey,
}: {
  side: "left" | "right";
  widthKey: "binderWidth" | "researchWidth";
}) {
  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useStore.getState().settings.layout[widthKey];
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const raw = side === "left" ? startWidth + dx : startWidth - dx;
      const width = Math.min(500, Math.max(160, Math.round(raw)));
      const s = useStore.getState();
      s.updateSettings({ layout: { ...s.settings.layout, [widthKey]: width } });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return <div className="pane-resizer" onMouseDown={onMouseDown} />;
}

/** Zeigt je nach Pane-Zustand Zeitstrahl, Corkboard, Recherche-Inhalt oder Editor. */
function PaneView({ paneId }: { paneId: PaneId }) {
  const timeline = useStore((s) => s.panes[paneId].timeline);
  const trash = useStore((s) => s.panes[paneId].trash);
  const corkboardId = useStore((s) => s.panes[paneId].corkboardId);
  const researchKind = useStore((s) => s.panes[paneId].researchKind);
  const isActive = useStore((s) => s.activePane === paneId && s.layoutMode !== "single");
  const setActivePane = useStore((s) => s.setActivePane);

  if (trash) {
    return (
      <section
        className={`editor ${isActive ? "pane-active" : ""}`}
        onMouseDownCapture={() => setActivePane(paneId)}
      >
        <TrashPanel />
      </section>
    );
  }
  if (timeline) {
    return (
      <section
        className={`editor ${isActive ? "pane-active" : ""}`}
        onMouseDownCapture={() => setActivePane(paneId)}
      >
        <TimelinePanel />
      </section>
    );
  }
  if (corkboardId) {
    return (
      <section
        className={`editor ${isActive ? "pane-active" : ""}`}
        onMouseDownCapture={() => setActivePane(paneId)}
      >
        <Corkboard chapterId={corkboardId} />
      </section>
    );
  }
  if (researchKind) {
    return <ResearchPane paneId={paneId} />;
  }
  return <RichEditor paneId={paneId} />;
}

/** Szene in diesem Pane wurde extern verändert, während lokal ungespeicherte Änderungen bestehen. */
function ConflictBanner({ paneId }: { paneId: PaneId }) {
  const saveState = useStore((s) => s.panes[paneId].saveState);
  const layoutMode = useStore((s) => s.layoutMode);
  const resolveConflict = useStore((s) => s.resolveConflict);
  if (saveState !== "conflict") return null;

  const labels: Record<PaneId, string> = {
    leftTop: "links oben",
    leftBottom: "links unten",
    rightTop: "rechts oben",
    rightBottom: "rechts unten",
  };
  const simpleLabels: Record<string, string> = { leftTop: "links", rightTop: "rechts" };
  const where =
    layoutMode === "single"
      ? ""
      : layoutMode === "cols"
        ? ` (Editor ${simpleLabels[paneId] ?? labels[paneId]})`
        : ` (Editor ${labels[paneId]})`;
  return (
    <div className="banner warning">
      <span>
        Dieses Dokument{where} wurde außerhalb der App verändert (z. B. durch Sync). Wie möchtest
        du fortfahren?
      </span>
      <button onClick={() => void resolveConflict(paneId, "reload")}>
        Externe Version laden (eigene Änderungen verwerfen)
      </button>
      <button onClick={() => void resolveConflict(paneId, "overwrite")}>
        Eigene Version behalten (extern überschreiben)
      </button>
    </div>
  );
}

/** Projektdateien wurden extern verändert (ohne lokalen Schreibkonflikt). */
function ExternalChangesBanner() {
  const externalChanges = useStore((s) => s.externalChanges);
  const anyConflict = useStore((s) =>
    PANE_IDS.some((id) => s.panes[id].saveState === "conflict"),
  );
  const reloadProject = useStore((s) => s.reloadProject);
  if (externalChanges.length === 0 || anyConflict) return null;

  return (
    <div className="banner warning">
      <span>
        {externalChanges.length === 1
          ? `Eine Projektdatei wurde außerhalb der App verändert (${externalChanges[0]}).`
          : `${externalChanges.length} Projektdateien wurden außerhalb der App verändert.`}
      </span>
      <button onClick={() => void reloadProject()}>Projekt neu laden</button>
    </div>
  );
}

export default App;
