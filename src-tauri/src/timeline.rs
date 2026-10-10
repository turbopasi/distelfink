//! Zeitstrahl: `timeline.json` (Reihenfolge = Array-Reihenfolge).

use crate::fsutil::write_atomic;
use crate::layout::TIMELINE_FILE;
use crate::project::{make_id, with_project, AppState, Saved};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimelineTrack {
    pub id: String,
    pub name: String,
    /// Farbcode aus der Palette des Frontends (COLOR_PRESETS); leer = keine
    /// eigene Farbe, dann zeichnet die Oberfläche den Strang in der Akzentfarbe.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: String,
    pub title: String,
    /// Freitext-Zeitangabe ("3. März 1899", "Tag 12", …) — bewusst kein
    /// Datumsformat, damit auch fiktive Kalender funktionieren.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub when: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scene_ids: Vec<String>,
    /// Personen, die im Ereignis vorkommen (IDs aus characters/).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub character_ids: Vec<String>,
    /// Orte, an denen das Ereignis spielt (IDs aus locations/).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub location_ids: Vec<String>,
    /// Handlungsstrang, zu dem das Ereignis gehört. Leer heißt "erster
    /// Strang" — so bleiben Dateien aus der Zeit vor den Strängen lesbar.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub track_id: String,
    /// Platz auf der gemeinsamen Zeitachse. Gleicher Slot in zwei Strängen
    /// heißt "zur selben Zeit"; übersprungene Slots sind gewollte Lücken.
    /// Fehlt in Dateien aus der Zeit vor den Slots — `normalize` trägt ihn nach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<u32>,
}

/// Der ganze Zeitstrahl einer Datei: Stränge, Ereignisse, Ausrichtung.
/// Die Reihenfolge im `events`-Array ist die Chronologie; innerhalb eines
/// Strangs zaehlt die relative Reihenfolge seiner Ereignisse.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    #[serde(default)]
    pub tracks: Vec<TimelineTrack>,
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
    /// "columns" (Stränge nebeneinander, Zeit läuft nach unten) oder "rows"
    /// (untereinander, Zeit läuft nach rechts). Leer = "columns".
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub orientation: String,
}

/// Name des Strangs, in dem Ereignisse aus der Zeit vor den Strängen landen.
const DEFAULT_TRACK_NAME: &str = "Haupthandlung";

#[tauri::command(async)]
pub fn load_timeline(state: tauri::State<AppState>) -> Result<Timeline, String> {
    with_project(&state, |p| {
        let mut timeline: Timeline = fs::read_to_string(p.abs(TIMELINE_FILE))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        p.note_mtime(TIMELINE_FILE);
        normalize(&mut timeline);
        Ok(timeline)
    })
}

/// Speichert den Zeitstrahl. Wurde die Datei seit dem Laden von außen geändert
/// (Sync), bleibt sie unangetastet und die Oberfläche fragt nach — außer `force`.
#[tauri::command]
pub fn save_timeline(
    mut timeline: Timeline,
    force: bool,
    state: tauri::State<AppState>,
) -> Result<Saved<Timeline>, String> {
    with_project(&state, |p| {
        if !force && p.changed_externally(TIMELINE_FILE) {
            return Ok(Saved::Conflict);
        }
        normalize(&mut timeline);
        let json =
            serde_json::to_string_pretty(&timeline).map_err(|e| format!("Serialisierung: {e}"))?;
        write_atomic(&p.abs(TIMELINE_FILE), json)
            .map_err(|e| format!("{TIMELINE_FILE} schreiben: {e}"))?;
        p.note_mtime(TIMELINE_FILE);
        p.search_dirty = true;
        Ok(Saved::Ok { data: timeline })
    })
}

/// Vergibt fehlende IDs (neue Einträge bringen ihre ID aus dem Frontend
/// mit; fehlen kann sie nur in alten Dateien) und sorgt dafür, dass es immer
/// mindestens einen Strang gibt und jedes Ereignis in einem vorhandenen
/// Strang hängt. Läuft beim Laden wie beim Speichern, damit die Oberfläche
/// keine Sonderfälle kennen muss und alte Dateien ohne Stränge einfach
/// mitwandern.
fn normalize(timeline: &mut Timeline) {
    if timeline.tracks.is_empty() {
        timeline.tracks.push(TimelineTrack {
            id: make_id(DEFAULT_TRACK_NAME),
            name: DEFAULT_TRACK_NAME.to_string(),
            color: String::new(),
        });
    }
    for track in timeline.tracks.iter_mut() {
        if track.id.is_empty() {
            track.id = make_id(&track.name);
        }
    }
    let first = timeline.tracks[0].id.clone();
    for ev in timeline.events.iter_mut() {
        if ev.id.is_empty() {
            ev.id = make_id(&ev.title);
        }
        if !timeline.tracks.iter().any(|t| t.id == ev.track_id) {
            ev.track_id = first.clone();
        }
    }
    // Slots: innerhalb eines Strangs streng steigend in Array-Reihenfolge.
    // Dateien aus der Zeit vor den Slots bekommen so 0, 1, 2 …, doppelt
    // belegte Slots lösen sich auf, und gewollte Lücken bleiben stehen, weil
    // ein vorhandener größerer Slot immer gewinnt.
    let mut last: HashMap<String, u32> = HashMap::new();
    for ev in timeline.events.iter_mut() {
        let next = last.get(&ev.track_id).map_or(0, |prev| prev + 1);
        let slot = ev.slot.unwrap_or(next).max(next);
        ev.slot = Some(slot);
        last.insert(ev.track_id.clone(), slot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alte_zeitstrahl_dateien_bekommen_einen_strang() {
        let mut tl = Timeline {
            tracks: Vec::new(),
            events: vec![TimelineEvent {
                id: "e-1".into(),
                title: "Ankunft".into(),
                when: String::new(),
                description: String::new(),
                scene_ids: Vec::new(),
                character_ids: Vec::new(),
                location_ids: Vec::new(),
                track_id: String::new(),
                slot: None,
            }],
            orientation: String::new(),
        };
        normalize(&mut tl);
        assert_eq!(tl.tracks.len(), 1);
        assert_eq!(tl.tracks[0].name, DEFAULT_TRACK_NAME);
        assert_eq!(tl.events[0].track_id, tl.tracks[0].id);
    }

    #[test]
    fn ereignis_im_geloeschten_strang_faellt_auf_den_ersten_zurueck() {
        let mut tl = Timeline {
            tracks: vec![
                TimelineTrack {
                    id: "a".into(),
                    name: "A".into(),
                    color: String::new(),
                },
                TimelineTrack {
                    id: "b".into(),
                    name: "B".into(),
                    color: String::new(),
                },
            ],
            events: vec![TimelineEvent {
                id: "e-1".into(),
                title: "Ankunft".into(),
                when: String::new(),
                description: String::new(),
                scene_ids: Vec::new(),
                character_ids: Vec::new(),
                location_ids: Vec::new(),
                track_id: "weg".into(),
                slot: None,
            }],
            orientation: String::new(),
        };
        normalize(&mut tl);
        assert_eq!(tl.events[0].track_id, "a");
    }

    /// Kleines Ereignis fuer die Slot-Tests.
    fn ev(id: &str, track: &str, slot: Option<u32>) -> TimelineEvent {
        TimelineEvent {
            id: id.into(),
            title: id.into(),
            when: String::new(),
            description: String::new(),
            scene_ids: Vec::new(),
            character_ids: Vec::new(),
            location_ids: Vec::new(),
            track_id: track.into(),
            slot,
        }
    }

    #[test]
    fn vergibt_slots_fuer_alte_dateien() {
        let mut tl = Timeline {
            tracks: vec![
                TimelineTrack {
                    id: "a".into(),
                    name: "A".into(),
                    color: String::new(),
                },
                TimelineTrack {
                    id: "b".into(),
                    name: "B".into(),
                    color: String::new(),
                },
            ],
            events: vec![
                ev("a1", "a", None),
                ev("a2", "a", None),
                ev("b1", "b", None),
            ],
            orientation: String::new(),
        };
        normalize(&mut tl);
        // Jeder Strang zaehlt fuer sich ab null — so steht alles nebeneinander,
        // wie es vor den Slots aussah.
        assert_eq!(tl.events[0].slot, Some(0));
        assert_eq!(tl.events[1].slot, Some(1));
        assert_eq!(tl.events[2].slot, Some(0));
    }

    #[test]
    fn haelt_luecken_und_loest_doppelte_slots_auf() {
        let mut tl = Timeline {
            tracks: vec![TimelineTrack {
                id: "a".into(),
                name: "A".into(),
                color: String::new(),
            }],
            events: vec![
                ev("a1", "a", Some(2)),
                ev("a2", "a", Some(2)),
                ev("a3", "a", Some(7)),
            ],
            orientation: String::new(),
        };
        normalize(&mut tl);
        assert_eq!(tl.events[0].slot, Some(2));
        assert_eq!(tl.events[1].slot, Some(3));
        assert_eq!(tl.events[2].slot, Some(7));
    }
}
