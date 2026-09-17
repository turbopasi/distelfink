<p>
  <img src="public/brand/distelfink-icon.svg" alt="" width="72" valign="middle">
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/distelfink-wordmark-on-dark.svg">
    <img src="public/brand/distelfink-wordmark.svg" alt="Distelfink" width="280" valign="middle">
  </picture>
</p>

Desktop-Schreibsoftware für Autoren, gebaut mit Tauri 2.x (React + TypeScript + Vite).
Bringt Binder, Corkboard, Zeitstrahl, Personen-/Ortsdatenbank, deutsche Normseite und
flexiblen Export in einer Anwendung zusammen.

**Zielplattformen:** Windows, Linux (macOS später)
**Lizenz:** Apache-2.0 — kostenlos und Open Source

**Kernprinzip Datenformat:** Ein Projekt ist ein Ordner mit vielen kleinen Dateien
(`.autorproj`) — keine einzelne SQLite- oder JSON-Datei. Das ermöglicht sichere Cloud-Synchronisation über Dropbox & Co. und
sinnvolles Git-Diffing. SQLite dient nur als regenerierbarer Such-/Index-Cache
(`.cache/index.sqlite`, nicht versioniert).

**Website:** <https://turbopasi.github.io/distelfink/>

## Installation

**[Aktuelle Version herunterladen](https://github.com/turbopasi/distelfink/releases/latest)**
— unter „Assets" das Windows-Setup (`.exe`) oder alternativ das `.msi`-Paket.
Linux- und macOS-Builds folgen, sobald sie dort getestet werden können.

Beim ersten Start warnt Windows SmartScreen vor einem unbekannten Herausgeber:
die Installer sind nicht mit einem EV-Zertifikat signiert, weil ein solches
jährlich mehrere hundert Euro kostet. Über „Weitere Informationen" →
„Trotzdem ausführen" lässt sich die Warnung bestätigen.

Aktualisiert wird die Anwendung selbst: Sie prüft beim Start, ob eine neuere
Version vorliegt, und bietet sie als Hinweis oben im Fenster an — Herunterladen
und Neustart erledigt sie dann selbst. Die Update-Pakete sind kryptografisch
signiert und werden vor der Installation geprüft. Wer das nicht möchte, kann
den Hinweis wegklicken und stattdessen jede Version von Hand installieren.

## Entwicklung

Voraussetzungen: Node LTS, Rust (stable), plattformspezifische Tauri-Dependencies
(siehe <https://tauri.app/start/prerequisites/>).

```sh
npm install
npm run tauri dev     # Entwicklungsmodus
npm run tauri build   # Release-Build (.exe/.msi bzw. .AppImage/.deb)
npm run build         # nur Frontend, inklusive Typprüfung
npm run notices       # THIRD-PARTY-NOTICES.md neu erzeugen

npx tsx scripts/align-roundtrip.test.mts
npx tsx scripts/plan-tag-roundtrip.test.mts
```

Ein Push auf `main` löst die CI aus (Windows + Linux). Reine Text-Änderungen
(`**.md`, `LICENSE`, `NOTICE`, `docs/**`) sind ausgenommen.

### Lizenzhinweise mitziehen

`THIRD-PARTY-NOTICES.md` wird **generiert, nie von Hand bearbeitet.** Der
Generator liest den echten Abhängigkeitsbaum und druckt jeden Lizenztext im
Wortlaut ab — MIT und BSD verlangen den Hinweis auch bei binärer Weitergabe,
die Pflicht gilt also für den gesamten Baum.

Sobald sich eine **Abhängigkeit** in `package.json` oder `src-tauri/Cargo.toml`
ändert, muss die Datei neu erzeugt und mitcommittet werden:

```sh
npm run notices
```

Die CI prüft das und wird rot, wenn die Datei veraltet ist. Ein reiner
Versions-Bump zählt nicht als Änderung in diesem Sinne — das Feld `version`
steht nicht im Abhängigkeitsbaum.

### Fallstrick: unvollständige `package-lock.json`

`npm install` hat schon zweimal beim Hinzufügen eines Pakets ein anderes
stillschweigend aus dem Lock geworfen (`@floating-ui/dom`, gemeldet als
„removed 1 package"). Lokal läuft `npm ci` danach trotzdem mit Exit-Code 0
durch, auf den CI-Runnern bricht es ab. Nach jedem `npm install` also:

```sh
npm ls @floating-ui/dom
```

Fehlt etwas, Lock neu aufbauen und danach `npm run notices` wiederholen:

```sh
rm -rf node_modules package-lock.json && npm install
```

## Ein Release veröffentlichen

Releases entstehen **ausschließlich** durch einen Tag `v*`; normale Commits auf
`main` lösen keins aus.

Einmalige Voraussetzung im Repository: **Settings → Actions → General →
Workflow permissions** muss auf „Read and write permissions" stehen. Sonst darf
der Workflow zwar bauen und signieren, aber kein Release anlegen, und bricht
ganz am Ende mit `Resource not accessible by integration` ab. Wichtig dabei:
Nach dem Ändern der Einstellung hilft „Re-run failed jobs" nicht — der Re-run
behält die alten Token-Rechte. Es braucht einen frischen Lauf, notfalls durch
Neusetzen des Tags:

```sh
git push origin :refs/tags/v0.1.0 && git tag -d v0.1.0
git tag v0.1.0 && git push origin v0.1.0
```

```sh
# 1. version anheben — in BEIDEN Dateien, identisch:
#    src-tauri/tauri.conf.json   <- diese zählt: sie landet in latest.json
#    src-tauri/Cargo.toml

# 2. Cargo.lock nachziehen (schnell, kein voller Build nötig)
cargo check --manifest-path src-tauri/Cargo.toml

# 3. committen und pushen
git add -A && git commit -m "Version 0.1.1"
git push

# 4. Tag setzen — muss zur version passen
git tag v0.1.1 && git push origin v0.1.1
```

Der Workflow prüft als Erstes, ob der Tag zu beiden Dateien passt, und bricht
sonst nach Sekunden mit einer klaren Meldung ab. Danach baut er die Installer,
signiert sie und legt ein Release **als Entwurf** an.

**Der Entwurf wird nicht von selbst öffentlich.** Erst „Publish release" macht
ihn zu `releases/latest` — und erst dann sehen installierte Exemplare das
Update. Vorher lohnt der Blick auf die Assets: neben `.exe` und `.msi` muss je
eine `.sig` hängen und eine `latest.json`. Fehlen sie, kann der Updater nichts
ausrichten.

Sinnvoll dazwischen: den Installer aus dem Entwurf einmal wirklich installieren
und starten, bevor du veröffentlichst.

Ein einmal gepushter Tag sollte nicht mehr wandern. Ging etwas schief, lieber
mit der nächsten Nummer weitermachen, als denselben Tag zu überschreiben — sonst
hat jemand eine andere 0.1.1 installiert und sieht nie ein Update.

## Projektstruktur

- `src/` — React-Frontend
- `src-tauri/` — Rust-Backend (Tauri Commands)
- `docs/` — Landing Page für GitHub Pages (samt Impressum)
- `public/brand/distelfink-icon.svg` — Signet als Quelle aller Icons; nach einer
  Änderung `npx tauri icon public/brand/distelfink-icon.svg` laufen lassen und
  die Kopien in `docs/` (`app-icon.png`, `icon-256.png`, `brand/`) nachziehen
- `.github/workflows/build.yml` — CI-Builds für Windows + Linux
- `.github/workflows/release.yml` — Release aus einem Tag `v*` (signierte
  Installer + `latest.json` fürs Selbst-Update)

## Lizenz

Der eigene Code steht unter der [Apache-Lizenz 2.0](LICENSE) — Nutzung,
Veränderung und Weitergabe sind frei, auch kommerziell; einzige Auflage ist,
Copyright- und Lizenzhinweis zu erhalten.

Die Anwendung bündelt Bestandteile Dritter (Schriften, Symbole, Bibliotheken),
deren Lizenzen einen Hinweis im Auslieferungsumfang verlangen. Diese Hinweise
stehen vollständig in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) und
werden vom Installer neben die Anwendung gelegt.

Die Datei wird erzeugt, nicht gepflegt — wie und wann, steht oben unter
[Lizenzhinweise mitziehen](#lizenzhinweise-mitziehen).
