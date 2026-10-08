import { describe, expect, it } from "vitest";
import {
  collectSceneIds,
  findNode,
  findParentAndIndex,
  flattenTree,
  flowSceneIds,
  isDescendant,
} from "./tree";
import type { BinderNode } from "./types";

const scene = (id: string): BinderNode => ({ id, kind: "scene", title: id, children: [] });
const chapter = (id: string, children: BinderNode[]): BinderNode => ({
  id,
  kind: "chapter",
  title: `Kapitel ${id}`,
  children,
});

const binder: BinderNode[] = [
  scene("prolog"),
  chapter("k1", [scene("s1"), scene("s2"), chapter("k1a", [scene("s3")])]),
  chapter("k2", [scene("s4")]),
];

describe("Binder-Baum", () => {
  it("findet Knoten in jeder Tiefe", () => {
    expect(findNode(binder, "s3")?.id).toBe("s3");
    expect(findNode(binder, "gibt-es-nicht")).toBeNull();
  });

  it("kennt Eltern und Platz eines Knotens", () => {
    expect(findParentAndIndex(binder, "prolog")).toEqual({ parentId: null, index: 0 });
    expect(findParentAndIndex(binder, "s2")).toEqual({ parentId: "k1", index: 1 });
    expect(findParentAndIndex(binder, "s3")).toEqual({ parentId: "k1a", index: 0 });
  });

  it("erkennt Nachfahren", () => {
    expect(isDescendant(binder, "k1", "s3")).toBe(true);
    expect(isDescendant(binder, "k2", "s3")).toBe(false);
  });

  it("sammelt Szenen in Manuskript-Reihenfolge", () => {
    expect(collectSceneIds(binder)).toEqual(["prolog", "s1", "s2", "s3", "s4"]);
  });

  it("bildet den Fluss aus allen Szenen unter demselben Kapitel", () => {
    expect(flowSceneIds(binder, "s2")).toEqual(["s1", "s2", "s3"]);
    expect(flowSceneIds(binder, "prolog")).toEqual(["prolog", "s1", "s2", "s3", "s4"]);
    expect(flowSceneIds(binder, "gibt-es-nicht")).toEqual([]);
  });

  it("liefert für die Schnellnavigation den Pfad aus Kapiteltiteln", () => {
    const s3 = flattenTree(binder).find((e) => e.node.id === "s3");
    expect(s3?.path).toEqual(["Kapitel k1", "Kapitel k1a"]);
  });
});
