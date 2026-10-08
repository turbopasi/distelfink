// @vitest-environment jsdom
// Speichern der Szenen über den Store, gegen ein nachgebautes Backend:
// Autosave, Fluss, Konflikte, Dokumentwechsel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BinderNode, ProjectInfo } from "../types";

/** Nachgebautes Backend: Szenentexte im Speicher, Konflikte auf Bestellung. */
const backend = {
  files: new Map<string, string>(),
  writes: [] as { id: string; content: string; force: boolean }[],
  /** IDs, deren nächstes Schreiben ohne `force` als Konflikt gilt. */
  conflicts: new Set<string>(),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    switch (cmd) {
      case "read_scene":
        return backend.files.get(args.id as string) ?? "";
      case "write_scene": {
        const { id, content, force } = args as { id: string; content: string; force: boolean };
        if (!force && backend.conflicts.has(id)) return { status: "conflict" };
        backend.conflicts.delete(id);
        backend.writes.push({ id, content, force });
        backend.files.set(id, content);
        return { status: "ok" };
      }
      default:
        throw new Error(`Im Test nicht nachgebaut: ${cmd}`);
    }
  }),
}));

const { registerContentSource, useStore } = await import(".");
const { emptyPanes, resetPaneSavers } = await import("./panes");
const { joinFlow, splitFlow } = await import("../flow");

const scene = (id: string): BinderNode => ({ id, kind: "scene", title: id, children: [] });
const project: ProjectInfo = {
  root: "/test",
  meta: {
    formatVersion: 1,
    title: "Test",
    author: "",
    created: "",
    binder: [{ id: "k1", kind: "chapter", title: "K1", children: [scene("s1"), scene("s2")] }],
  },
};

const pane = () => useStore.getState().panes.leftTop;

/** Simuliert den Editor: liefert `text` als Inhalt und meldet Änderungen. */
function editor() {
  let text = pane().content;
  const unregister = registerContentSource("leftTop", () => text);
  return {
    type(next: string) {
      text = next;
      useStore.getState().markDirty("leftTop");
    },
    unregister,
  };
}

describe("Speichern der Szenen", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    backend.files = new Map([
      ["s1", "Erste Szene.\n"],
      ["s2", "Zweite Szene.\n"],
    ]);
    backend.writes = [];
    backend.conflicts.clear();
    // Der Store ist für alle Tests derselbe: jeder beginnt mit leeren Bereichen.
    resetPaneSavers();
    useStore.setState({ project, flowMode: false, panes: emptyPanes(), error: null });
    await useStore.getState().selectScene("s1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("speichert nach der Pause automatisch", async () => {
    const ed = editor();
    ed.type("Geändert.\n");
    expect(pane().saveState).toBe("dirty");
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2500);
    expect(backend.writes).toEqual([{ id: "s1", content: "Geändert.\n", force: false }]);
    expect(pane().saveState).toBe("saved");
    ed.unregister();
  });

  it("schreibt beim Wechsel zu einer anderen Szene vorher die alte", async () => {
    const ed = editor();
    ed.type("Noch nicht gespeichert.\n");
    await useStore.getState().selectScene("s2");
    expect(backend.files.get("s1")).toBe("Noch nicht gespeichert.\n");
    expect(pane().content).toBe("Zweite Szene.\n");
    expect(pane().saveState).toBe("saved");
    ed.unregister();
  });

  it("schreibt im Fluss nur die geänderte Szene", async () => {
    useStore.setState({ flowMode: true });
    await useStore.getState().selectScene("s2");
    const ed = editor();
    const parts = splitFlow(pane().content, ["s1", "s2"]);
    parts[1].content = "Zweite Szene, überarbeitet.\n";
    ed.type(joinFlow(parts));
    await useStore.getState().flushPane("leftTop");
    expect(backend.writes).toEqual([
      { id: "s2", content: "Zweite Szene, überarbeitet.\n", force: false },
    ]);
    ed.unregister();
  });

  it("schreibt bei einem Konflikt nichts mehr, bis entschieden ist", async () => {
    backend.conflicts.add("s1");
    const ed = editor();
    ed.type("Eigene Fassung.\n");
    await useStore.getState().flushPane("leftTop");
    expect(pane().saveState).toBe("conflict");
    expect(backend.writes).toHaveLength(0);

    ed.type("Eigene Fassung, weiter.\n");
    await vi.advanceTimersByTimeAsync(2500);
    expect(backend.writes).toHaveLength(0);
    expect(pane().saveState).toBe("conflict");

    await useStore.getState().resolveConflict("leftTop", "overwrite");
    expect(backend.writes).toEqual([
      { id: "s1", content: "Eigene Fassung, weiter.\n", force: true },
    ]);
    expect(pane().saveState).toBe("saved");
    ed.unregister();
  });

  it("lädt bei „Externe Version laden“ den Stand von der Platte", async () => {
    backend.conflicts.add("s1");
    const ed = editor();
    ed.type("Eigene Fassung.\n");
    await useStore.getState().flushPane("leftTop");
    backend.files.set("s1", "Fassung vom anderen Rechner.\n");

    await useStore.getState().resolveConflict("leftTop", "reload");
    expect(pane().content).toBe("Fassung vom anderen Rechner.\n");
    expect(pane().saveState).toBe("saved");
    // Nichts mehr offen: auch ein späteres Speichern schreibt nichts.
    await useStore.getState().flushPane("leftTop");
    expect(backend.writes).toHaveLength(0);
    ed.unregister();
  });

  it("verhindert das Schließen des Projekts bei offenem Konflikt", async () => {
    backend.conflicts.add("s1");
    const ed = editor();
    ed.type("Eigene Fassung.\n");
    await useStore.getState().flushPane("leftTop");
    await useStore.getState().closeProject();
    expect(useStore.getState().project).not.toBeNull();
    expect(useStore.getState().error).toMatch(/Schreibkonflikt/);
    ed.unregister();
  });
});
