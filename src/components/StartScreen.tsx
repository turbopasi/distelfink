import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { loadRecents, useStore } from "../store";

/** Version aus der Anwendung selbst, nicht aus package.json — im
 *  Entwicklungsmodus steht hier dieselbe Nummer wie im Installer. */
function useAppVersion() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
  }, []);
  return version;
}

export function StartScreen() {
  const { createProject, openProject } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const recents = loadRecents();
  const version = useAppVersion();

  async function handleCreate() {
    if (!name.trim()) return;
    const dir = await open({
      directory: true,
      title: "Speicherort für das Projekt wählen",
    });
    if (typeof dir === "string") {
      await createProject(dir, name.trim(), author.trim());
    }
  }

  async function handleOpen() {
    const dir = await open({
      directory: true,
      title: "Projektordner (.autorproj) öffnen",
    });
    if (typeof dir === "string") await openProject(dir);
  }

  return (
    <main className="start-screen">
      {/* Wortmarke als CSS-Maske: die Fläche erbt currentColor und läuft
          dadurch in allen Themes mit, statt zwei Farbvarianten zu pflegen. */}
      <img className="app-mark" src="/brand/distelfink-icon.svg" alt="" width="96" height="96" />
      <h1 className="wordmark">
        <span className="wordmark-mark" role="img" aria-label="Distelfink" />
      </h1>
      <p className="muted">Desktop-Schreibsoftware für Autoren</p>

      {creating ? (
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <input
            autoFocus
            placeholder="Projektname (z. B. Mein Roman)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            placeholder="Autor (optional)"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
          <div className="row">
            <button type="submit" disabled={!name.trim()}>
              Speicherort wählen …
            </button>
            <button type="button" onClick={() => setCreating(false)}>
              Abbrechen
            </button>
          </div>
          <p className="muted small">
            Tipp: Lege den Projektordner in deinen Dropbox-/Google-Drive-/OneDrive-Ordner,
            um automatisch zu synchronisieren.
          </p>
        </form>
      ) : (
        <div className="row">
          <button onClick={() => setCreating(true)}>Neues Projekt</button>
          <button onClick={() => void handleOpen()}>Projekt öffnen …</button>
        </div>
      )}

      {recents.length > 0 && (
        <section className="recents">
          <h2>Zuletzt geöffnet</h2>
          <ul>
            {recents.map((path) => (
              <li key={path}>
                <button className="link" onClick={() => void openProject(path)}>
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {version && <p className="muted small app-version">Version {version}</p>}
    </main>
  );
}
