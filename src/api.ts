import { invoke } from "@tauri-apps/api/core";
import type {
  Entity,
  EntityKind,
  ExportFormat,
  ExportTemplate,
  Mention,
  Mindboard,
  MindboardInfo,
  NodeKind,
  ProjectInfo,
  Saved,
  SearchHit,
  Timeline,
  TrashItem,
  VersionInfo,
  WriteResult,
} from "./types";

export const api = {
  createProject: (parentDir: string, name: string, title: string, author: string) =>
    invoke<ProjectInfo>("create_project", { parentDir, name, title, author }),
  openProject: (path: string) => invoke<ProjectInfo>("open_project", { path }),
  closeProject: () => invoke<void>("close_project"),
  saveProjectAs: (parentDir: string, name: string) =>
    invoke<ProjectInfo>("save_project_as", { parentDir, name }),
  readScene: (id: string) => invoke<string>("read_scene", { id }),
  writeScene: (id: string, content: string, force = false) =>
    invoke<WriteResult>("write_scene", { id, content, force }),
  createNode: (parentId: string | null, kind: NodeKind, title: string) =>
    invoke<ProjectInfo>("create_node", { parentId, kind, title }),
  renameNode: (id: string, title: string) =>
    invoke<ProjectInfo>("rename_node", { id, title }),
  moveNode: (id: string, newParentId: string | null, index: number) =>
    invoke<ProjectInfo>("move_node", { id, newParentId, index }),
  updateNodeMeta: (
    id: string,
    patch: {
      synopsis?: string;
      status?: string;
      /** "" löscht die Farbe. */
      color?: string;
      tags?: string[];
      /** Kartenbild (rel. Pfad unter images/); "" entfernt es. */
      image?: string;
    },
  ) => invoke<ProjectInfo>("update_node_meta", { id, ...patch }),
  /** Kopie samt Unterbaum und Szenendateien, direkt hinter dem Original. */
  duplicateNode: (id: string) => invoke<ProjectInfo>("duplicate_node", { id }),
  deleteNode: (id: string) => invoke<ProjectInfo>("delete_node", { id }),
  checkExternalChanges: () => invoke<string[]>("check_external_changes"),

  listTrash: () => invoke<TrashItem[]>("list_trash"),
  countTrash: () => invoke<number>("count_trash"),
  /** Legt den Eintrag an seinen Platz zurück; liefert das aktualisierte Projekt. */
  restoreTrash: (key: string) => invoke<ProjectInfo>("restore_trash", { key }),
  deleteTrashItem: (key: string) => invoke<void>("delete_trash_item", { key }),
  emptyTrash: () => invoke<void>("empty_trash"),

  listEntities: (kind: EntityKind) => invoke<Entity[]>("list_entities", { kind }),
  saveEntity: (kind: EntityKind, entity: Entity) =>
    invoke<Entity>("save_entity", { kind, entity }),
  /** Kopie samt Freitext-Dokument und Bild. */
  duplicateEntity: (kind: EntityKind, id: string) =>
    invoke<Entity>("duplicate_entity", { kind, id }),
  deleteEntity: (kind: EntityKind, id: string) =>
    invoke<void>("delete_entity", { kind, id }),
  setEntityImage: (kind: EntityKind, id: string, sourcePath: string) =>
    invoke<Entity>("set_entity_image", { kind, id, sourcePath }),
  getEntityImage: (kind: EntityKind, id: string) =>
    invoke<string | null>("get_entity_image", { kind, id }),

  /** Patcht nur Name und/oder Szenen-Verknüpfungen (liest den Rest von Platte). */
  updateEntityMeta: (
    kind: EntityKind,
    id: string,
    patch: { name?: string; sceneIds?: string[] },
  ) => invoke<Entity>("update_entity_meta", { kind, id, ...patch }),
  readEntityDoc: (kind: EntityKind, id: string) =>
    invoke<string>("read_entity_doc", { kind, id }),
  writeEntityDoc: (kind: EntityKind, id: string, content: string, force = false) =>
    invoke<WriteResult>("write_entity_doc", { kind, id, content, force }),

  /** Speichert ein eingefügtes Bild unter images/; liefert den relativen Pfad. */
  saveDocImage: (dataBase64: string, ext: string) =>
    invoke<string>("save_doc_image", { dataBase64, ext }),
  /** Kopiert eine Bilddatei (Dateidialog) nach images/; liefert den relativen Pfad. */
  importDocImage: (sourcePath: string) =>
    invoke<string>("import_doc_image", { sourcePath }),
  /** Dokument-Bild als data-URL (null, wenn die Datei fehlt). */
  readDocImage: (rel: string) => invoke<string | null>("read_doc_image", { rel }),

  loadTimeline: () => invoke<Timeline>("load_timeline"),
  saveTimeline: (timeline: Timeline, force = false) =>
    invoke<Saved<Timeline>>("save_timeline", { timeline, force }),

  listMindboards: () => invoke<MindboardInfo[]>("list_mindboards"),
  createMindboard: (name: string) => invoke<MindboardInfo>("create_mindboard", { name }),
  loadMindboard: (id: string) => invoke<Mindboard>("load_mindboard", { id }),
  saveMindboard: (board: Mindboard, force = false) =>
    invoke<Saved<Mindboard>>("save_mindboard", { board, force }),
  renameMindboard: (id: string, name: string) =>
    invoke<void>("rename_mindboard", { id, name }),
  deleteMindboard: (id: string) => invoke<void>("delete_mindboard", { id }),
  /** Schreibt einen PNG-Export (base64) an einen frei gewählten Ort. */
  writeMindboardPng: (path: string, dataBase64: string) =>
    invoke<void>("write_mindboard_png", { path, dataBase64 }),

  searchProject: (query: string) => invoke<SearchHit[]>("search_project", { query }),

  /** Alle Stellen, an denen ein Planungs-Tag auf diesen Eintrag zeigt.
   *  tagKind ist die Tag-Art ("person" | "location"). */
  listMentions: (tagKind: string, id: string) =>
    invoke<Mention[]>("list_mentions", { tagKind, id }),

  /** Sicherungspunkt über das ganze Projekt; true = es gab etwas zu sichern. */
  snapshot: (message: string | null = null) => invoke<boolean>("snapshot", { message }),
  listHistory: (rel: string) => invoke<VersionInfo[]>("list_history", { rel }),
  getVersion: (commitId: string, rel: string) =>
    invoke<string>("get_version", { commitId, rel }),
  /** Stellt eine Version wieder her und liefert den Inhalt zurück. */
  restoreVersion: (commitId: string, rel: string) =>
    invoke<string>("restore_version", { commitId, rel }),

  listExportTemplates: () => invoke<ExportTemplate[]>("list_export_templates"),
  saveExportTemplate: (template: ExportTemplate) =>
    invoke<ExportTemplate[]>("save_export_template", { template }),
  deleteExportTemplate: (id: string) =>
    invoke<ExportTemplate[]>("delete_export_template", { id }),
  /** Exportiert die ausgewählten Binder-Teile; liefert den finalen Dateipfad. */
  exportProject: (
    format: ExportFormat,
    template: ExportTemplate,
    includeIds: string[],
    outPath: string,
  ) => invoke<string>("export_project", { format, template, includeIds, outPath }),

  /** App-weite Einstellungen (Phase 7); Schema gehört dem Frontend. */
  loadSettings: () => invoke<unknown>("load_settings"),
  saveSettings: (settings: unknown) => invoke<void>("save_settings", { settings }),

  /** Kopiert ein Hintergrundbild ins App-Config-Verzeichnis; liefert den Dateinamen. */
  importBackgroundImage: (sourcePath: string) =>
    invoke<string>("import_background_image", { sourcePath }),
  /** Hintergrundbild als data-URL (null, wenn die Datei fehlt). */
  readBackgroundImage: (name: string) =>
    invoke<string | null>("read_background_image", { name }),
  clearBackgroundImage: () => invoke<void>("clear_background_image"),
};

/** Projektrelativer Pfad einer Szenendatei (muss zum Rust-Backend passen). */
export const sceneRelPath = (id: string) => `manuscript/${id}.md`;
