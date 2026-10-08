/**
 * Erzeugt THIRD-PARTY-NOTICES.md aus dem tatsächlichen Abhängigkeitsbaum.
 *
 * Hintergrund: MIT, BSD, ISC und Apache-2.0 verlangen alle, dass ihr
 * Copyright- und Lizenzhinweis der *binären* Weitergabe beiliegt. Ein Link
 * auf GitHub genügt dafür nicht. Weil sich der Baum mit jedem `npm install`
 * und jedem Crate-Update verschiebt, wird die Datei generiert statt gepflegt.
 *
 *   npm run notices
 *
 * Erfasst wird nur, was wirklich ausgeliefert wird:
 *   - Rust: Laufzeit-Abhängigkeiten (keine dev-/build-Dependencies) für die
 *     Zielplattformen Windows und Linux.
 *   - npm: der Produktionsbaum (`--omit=dev`); Vite, TypeScript & Co. landen
 *     nicht im Bundle und tauchen darum nicht auf.
 *
 * Handgeschriebene Ergänzungen (Schriften, Symbole, libgit2) stehen in
 * PREAMBLE weiter unten — die kommen nicht aus einem Paketmanager.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = path.join(ROOT, "src-tauri");
const OUT = path.join(ROOT, "THIRD-PARTY-NOTICES.md");

/** Zielplattformen der Releases. Plattformfremde Crates (gtk, objc2 …) fliegen raus. */
const PLATFORMS = ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"];

/** Dateinamen, die einen Lizenztext enthalten können. */
const LICENSE_FILE = /^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|UNLICENSE)([-._].*)?$/i;

type Component = {
  name: string;
  version: string;
  license: string;
  origin: "Rust-Crate" | "npm-Paket";
  texts: string[];
};

// ---------------------------------------------------------------- Lizenztexte

/** Sammelt alle Lizenzdateien in einem Paketverzeichnis, längster Text zuerst. */
function readLicenseTexts(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const texts: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !LICENSE_FILE.test(e.name)) continue;
    const raw = fs.readFileSync(path.join(dir, e.name), "utf8").replace(/\r\n/g, "\n").trim();
    // Manche Pakete legen eine LICENSE mit nur "MIT" darin ab — wertlos.
    if (raw.length > 120) texts.push(raw);
  }
  return texts.sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------- Rust

function cargoMetadata(platform: string) {
  const out = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--filter-platform", platform],
    { cwd: TAURI, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

/**
 * Läuft den Resolve-Graphen ab und nimmt nur normale Abhängigkeiten mit.
 * dev-Dependencies laufen nur in Tests, build-Dependencies (Codegen,
 * proc-macros) erzeugen die Binary, landen aber nicht darin.
 */
function runtimeCrates(meta: any): Set<string> {
  const nodes = new Map<string, any>(meta.resolve.nodes.map((n: any) => [n.id, n]));
  const keep = new Set<string>();
  const stack = [meta.resolve.root ?? meta.workspace_members[0]];
  while (stack.length) {
    const id = stack.pop()!;
    if (keep.has(id)) continue;
    keep.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const normal = dep.dep_kinds.some((k: any) => k.kind === null || k.kind === undefined);
      if (normal) stack.push(dep.pkg);
    }
  }
  return keep;
}

function collectRust(): Component[] {
  const byId = new Map<string, Component>();
  for (const platform of PLATFORMS) {
    const meta = cargoMetadata(platform);
    const keep = runtimeCrates(meta);
    for (const pkg of meta.packages) {
      if (!keep.has(pkg.id) || byId.has(pkg.id)) continue;
      if (pkg.source === null) continue; // das eigene Crate
      const dir = path.dirname(pkg.manifest_path);
      byId.set(pkg.id, {
        name: pkg.name,
        version: pkg.version,
        // Cargo erlaubt "MIT/Apache-2.0" (alt) wie "MIT OR Apache-2.0" (SPDX).
        license: (pkg.license ?? "").replace(/\//g, " OR ").trim() || "siehe Lizenztext",
        origin: "Rust-Crate",
        texts: readLicenseTexts(dir),
      });
    }
  }
  return [...byId.values()];
}

// ----------------------------------------------------------------------- npm

function collectNpm(): Component[] {
  // `npm ls` meldet Exit-Code != 0 bei Peer-Warnungen; Ausgabe trotzdem nutzen.
  let out: string;
  try {
    out = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32",
    });
  } catch (err: any) {
    out = err.stdout ?? "";
  }
  const byName = new Map<string, Component>();
  for (const dir of out.split(/\r?\n/)) {
    if (!dir.includes("node_modules")) continue;
    const pjPath = path.join(dir, "package.json");
    if (!fs.existsSync(pjPath)) continue;
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    const key = `${pj.name}@${pj.version}`;
    if (byName.has(key)) continue;
    const license =
      typeof pj.license === "string"
        ? pj.license
        : pj.license?.type ?? pj.licenses?.map((l: any) => l.type).join(" OR ") ?? "siehe Lizenztext";
    byName.set(key, {
      name: pj.name,
      version: pj.version,
      license,
      origin: "npm-Paket",
      texts: readLicenseTexts(dir),
    });
  }
  return [...byName.values()];
}

// -------------------------------------------------------------------- Ausgabe

const PREAMBLE = `# Hinweise zu Bestandteilen Dritter

Distelfink selbst steht unter der Apache-Lizenz 2.0 (siehe \`LICENSE\`).
Die ausgelieferte Anwendung enthält darüber hinaus Bestandteile Dritter. Deren
Lizenzen verlangen, dass Copyright- und Lizenzhinweis der Weitergabe beiliegen —
genau dazu dient diese Datei.

> Diese Datei wird erzeugt: \`npm run notices\`. Nicht von Hand bearbeiten;
> Ergänzungen gehören in \`scripts/generate-third-party-notices.mts\`.

## Übersicht der besonderen Fälle

**Schriften** (\`public/fonts/\`) — SIL Open Font License 1.1, unverändert gebündelt:

- Literata — Copyright 2017 The Literata Project Authors
  (https://github.com/googlefonts/literata)
- IBM Plex Sans und IBM Plex Mono — Copyright © 2017 IBM Corp. with Reserved
  Font Name "Plex" (https://github.com/IBM/plex)

Die vollständigen Lizenztexte stehen weiter unten unter „Lizenztexte der
gebündelten Assets". Die OFL untersagt den Verkauf der Schriftdateien für sich
genommen; als Bestandteil dieser Anwendung ist die Weitergabe ausdrücklich
erlaubt. Dokumente, die mit den Schriften gesetzt werden, unterliegen der OFL
nicht.

**Symbole** (\`src/components/Icon.tsx\`) — Lucide 0.462.0, ISC-Lizenz. 13 der 32
verwendeten Glyphen stammen ursprünglich aus Feather und stehen zusätzlich unter
MIT © 2013–present Cole Bemis: arrow-down, arrow-up, chevron-down,
chevron-right, clock, info, italic, link-2, maximize, plus, search, trash-2, x.

**Farbthemes** (\`src/presetThemes.ts\`) — die Farbwerte der „Weiteren Themes“
stammen aus daisyUI 5.7.43, MIT © 2020 Pouya Saadeghi (https://daisyui.com).
daisyUI selbst wird nicht ausgeliefert; übernommen und umgerechnet sind nur die
Farben.

**libgit2** — über das Crate \`libgit2-sys\` einkompiliert (Version 1.9.7).
Lizenziert unter GPL-2.0 **mit Linking-Ausnahme**, die das Einbinden in
Programme beliebiger Lizenz ausdrücklich erlaubt. Auf diese Anwendung wirkt sich
das Copyleft daher nicht aus. Quellcode: https://github.com/libgit2/libgit2

**SQLite** — über \`rusqlite\` mit \`bundled\`-Feature einkompiliert. SQLite ist
gemeinfrei (Public Domain), es bestehen keinerlei Auflagen.

**MPL-2.0-Bestandteile** — \`epub-builder\`, \`cssparser\`, \`selectors\`,
\`dtoa-short\` und \`option-ext\` stehen unter der Mozilla Public License 2.0.
Deren Copyleft ist dateibezogen und greift nur bei Änderungen an diesen Crates
selbst; solche Änderungen gibt es hier nicht. Die MPL verlangt bei binärer
Weitergabe zusätzlich den Hinweis, woher der Quellcode zu beziehen ist: jeweils
über https://crates.io/crates/<name> und die dort verlinkten Repositories.

**Systemschriften beim PDF-Export** — für den PDF-Export lädt die Anwendung
Schriften aus dem Betriebssystem (Windows: \`%WINDIR%\\Fonts\`; Linux: Liberation
bzw. DejaVu). Diese Dateien werden nicht mitgeliefert und nicht weitergegeben.

---
`;

/**
 * Assets, die kein Paketmanager verwaltet. Ihre Lizenztexte liegen zwar im
 * Repository, aber nicht im Installationsverzeichnis — sie müssen darum hier
 * im Wortlaut mit hinein, sonst reist der Hinweis nicht mit der Binary.
 */
const ASSET_LICENSES: Array<{ title: string; file: string }> = [
  { title: "Literata — SIL Open Font License 1.1", file: "public/fonts/OFL-Literata.txt" },
  { title: "IBM Plex Sans / IBM Plex Mono — SIL Open Font License 1.1", file: "public/fonts/OFL-IBM-Plex.txt" },
  { title: "Lucide-Symbole — ISC, teilweise zusätzlich MIT (Feather)", file: "src/components/Icon.LICENSE.txt" },
  { title: "daisyUI-Farbthemes — MIT", file: "src/presetThemes.LICENSE.txt" },
];

function render(components: Component[]): string {
  components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const lines: string[] = [PREAMBLE];

  lines.push("## Lizenztexte der gebündelten Assets\n");
  for (const asset of ASSET_LICENSES) {
    const text = fs.readFileSync(path.join(ROOT, asset.file), "utf8").replace(/\r\n/g, "\n").trim();
    lines.push(`### ${asset.title}\n`);
    lines.push("```text", text, "```\n");
  }
  lines.push("---\n");

  lines.push(`## Verzeichnis (${components.length} Bestandteile)\n`);
  lines.push("| Bestandteil | Version | Herkunft | Lizenz |");
  lines.push("| --- | --- | --- | --- |");
  for (const c of components) {
    lines.push(`| ${c.name} | ${c.version} | ${c.origin} | ${c.license} |`);
  }

  // Identische Lizenztexte (etwa die unveränderte Apache-2.0) nur einmal
  // abdrucken und die betroffenen Pakete darüber auflisten.
  const groups = new Map<string, { text: string; owners: string[] }>();
  const withoutText: string[] = [];
  for (const c of components) {
    if (c.texts.length === 0) {
      withoutText.push(`${c.name} ${c.version} (${c.license})`);
      continue;
    }
    const combined = c.texts.join("\n\n---\n\n");
    const key = createHash("sha256").update(combined).digest("hex");
    const group = groups.get(key) ?? { text: combined, owners: [] };
    group.owners.push(`${c.name} ${c.version} — ${c.license}`);
    groups.set(key, group);
  }

  lines.push(`\n## Lizenztexte\n`);
  const sorted = [...groups.values()].sort((a, b) => a.owners[0].localeCompare(b.owners[0]));
  for (const group of sorted) {
    lines.push(`### ${group.owners.length === 1 ? group.owners[0] : "Gemeinsamer Lizenztext"}\n`);
    if (group.owners.length > 1) {
      lines.push("Gilt für:\n");
      for (const owner of group.owners) lines.push(`- ${owner}`);
      lines.push("");
    }
    lines.push("```text");
    lines.push(group.text);
    lines.push("```\n");
  }

  if (withoutText.length) {
    lines.push(`## Ohne mitgelieferten Lizenztext\n`);
    lines.push(
      "Diese Pakete legen ihrer Veröffentlichung keine Lizenzdatei bei. Es gilt die",
      "im Manifest angegebene Lizenz; der Wortlaut ist über die jeweilige SPDX-Kennung",
      "unter https://spdx.org/licenses/ abrufbar.\n",
    );
    for (const entry of withoutText.sort()) lines.push(`- ${entry}`);
    lines.push("");
  }

  return lines.join("\n");
}

const components = [...collectRust(), ...collectNpm()];
fs.writeFileSync(OUT, render(components), "utf8");
console.log(
  `THIRD-PARTY-NOTICES.md geschrieben: ${components.length} Bestandteile, ` +
    `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`,
);
