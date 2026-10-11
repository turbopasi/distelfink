//! Zeitstrahl: `timeline.json`. Jedes Ereignis liegt als Balken auf einer
//! gemeinsamen, abstrakten Zeitachse (Anfang + Länge in Rastereinheiten).

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
    /// Die Synopsis des Ereignisses.
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
    /// Anfang auf der Zeitachse in Rastereinheiten (darf negativ sein).
    /// Fehlt nur in Dateien aus der Zeit der Slots — `normalize` trägt ihn nach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<i32>,
    /// Länge in Rastereinheiten, mindestens 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<u32>,
    /// Altes Raster (ein Platz pro Ereignis). Wird nur noch gelesen, um daraus
    /// `start` und `length` zu machen.
    #[serde(default, skip_serializing)]
    pub slot: Option<u32>,
}

/// Der ganze Zeitstrahl einer Datei: Stränge und Ereignisse. Innerhalb eines
/// Strangs überlappen sich keine Ereignisse.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    #[serde(default)]
    pub tracks: Vec<TimelineTrack>,
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
}

/// Name des Strangs, in dem Ereignisse aus der Zeit vor den Strängen landen.
const DEFAULT_TRACK_NAME: &str = "Haupthandlung";

/// Länge, die ein Ereignis aus der Slot-Zeit bekommt. Ein Slot wird zu so
/// vielen Einheiten — die alte Ausrichtung bleibt damit genau erhalten.
const DEFAULT_LENGTH: u32 = 4;

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
/// mindestens einen Strang gibt, jedes Ereignis in einem vorhandenen Strang
/// hängt, Anfang und Länge hat und sich in seinem Strang mit nichts
/// überlappt. Läuft beim Laden wie beim Speichern, damit die Oberfläche
/// keine Sonderfälle kennen muss und alte Dateien einfach mitwandern.
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
    // Aus der Slot-Zeit: Slots innerhalb eines Strangs streng steigend in
    // Array-Reihenfolge (Dateien ganz ohne Slots bekommen 0, 1, 2 …), dann
    // wird jeder Slot zu DEFAULT_LENGTH Einheiten.
    let mut last: HashMap<String, u32> = HashMap::new();
    for ev in timeline.events.iter_mut() {
        if ev.start.is_none() {
            let next = last.get(&ev.track_id).map_or(0, |prev| prev + 1);
            let slot = ev.slot.unwrap_or(next).max(next);
            last.insert(ev.track_id.clone(), slot);
            ev.start = Some((slot * DEFAULT_LENGTH) as i32);
        }
        ev.slot = None;
        ev.length = Some(ev.length.unwrap_or(DEFAULT_LENGTH).max(1));
    }
    // Strangweise nach Anfang sortiert schreiben, damit die Datei stabil
    // bleibt; dabei lösen sich Überlappungen (Sync, Handarbeit an der Datei)
    // auf, indem das spätere Ereignis hinter das frühere rückt.
    let order: HashMap<String, usize> = timeline
        .tracks
        .iter()
        .enumerate()
        .map(|(i, t)| (t.id.clone(), i))
        .collect();
    timeline
        .events
        .sort_by_key(|ev| (order[&ev.track_id], ev.start.unwrap_or(0)));
    let mut end: HashMap<String, i32> = HashMap::new();
    for ev in timeline.events.iter_mut() {
        let mut start = ev.start.unwrap_or(0);
        if let Some(&prev_end) = end.get(&ev.track_id) {
            start = start.max(prev_end);
        }
        ev.start = Some(start);
        end.insert(ev.track_id.clone(), start + ev.length.unwrap_or(1) as i32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str) -> TimelineTrack {
        TimelineTrack {
            id: id.into(),
            name: id.to_uppercase(),
            color: String::new(),
        }
    }

    /// Kleines Ereignis für die Tests, noch ohne Platz auf der Achse.
    fn ev(id: &str, track: &str) -> TimelineEvent {
        TimelineEvent {
            id: id.into(),
            title: id.into(),
            when: String::new(),
            description: String::new(),
            scene_ids: Vec::new(),
            character_ids: Vec::new(),
            location_ids: Vec::new(),
            track_id: track.into(),
            start: None,
            length: None,
            slot: None,
        }
    }

    fn at(id: &str, track: &str, start: i32, length: u32) -> TimelineEvent {
        TimelineEvent {
            start: Some(start),
            length: Some(length),
            ..ev(id, track)
        }
    }

    fn slotted(id: &str, track: &str, slot: Option<u32>) -> TimelineEvent {
        TimelineEvent {
            slot,
            ..ev(id, track)
        }
    }

    fn spans(tl: &Timeline) -> Vec<(&str, i32, u32)> {
        tl.events
            .iter()
            .map(|e| (e.id.as_str(), e.start.unwrap(), e.length.unwrap()))
            .collect()
    }

    #[test]
    fn alte_zeitstrahl_dateien_bekommen_einen_strang() {
        let mut tl = Timeline {
            tracks: Vec::new(),
            events: vec![ev("e-1", "")],
        };
        normalize(&mut tl);
        assert_eq!(tl.tracks.len(), 1);
        assert_eq!(tl.tracks[0].name, DEFAULT_TRACK_NAME);
        assert_eq!(tl.events[0].track_id, tl.tracks[0].id);
    }

    #[test]
    fn ereignis_im_geloeschten_strang_faellt_auf_den_ersten_zurueck() {
        let mut tl = Timeline {
            tracks: vec![track("a"), track("b")],
            events: vec![ev("e-1", "weg")],
        };
        normalize(&mut tl);
        assert_eq!(tl.events[0].track_id, "a");
    }

    #[test]
    fn dateien_ohne_slots_werden_strangweise_aufgereiht() {
        let mut tl = Timeline {
            tracks: vec![track("a"), track("b")],
            events: vec![ev("a1", "a"), ev("b1", "b"), ev("a2", "a")],
        };
        normalize(&mut tl);
        // Jeder Strang beginnt bei null — so steht alles nebeneinander, wie
        // es vor den Slots aussah.
        assert_eq!(spans(&tl), vec![("a1", 0, 4), ("a2", 4, 4), ("b1", 0, 4)]);
    }

    #[test]
    fn slots_werden_zu_anfang_und_laenge_mit_luecken() {
        let mut tl = Timeline {
            tracks: vec![track("a")],
            events: vec![
                slotted("a1", "a", Some(2)),
                slotted("a2", "a", Some(2)),
                slotted("a3", "a", Some(7)),
            ],
        };
        normalize(&mut tl);
        assert_eq!(spans(&tl), vec![("a1", 8, 4), ("a2", 12, 4), ("a3", 28, 4)]);
        assert!(tl.events.iter().all(|e| e.slot.is_none()));
    }

    #[test]
    fn ueberlappungen_loesen_sich_auf() {
        let mut tl = Timeline {
            tracks: vec![track("a"), track("b")],
            events: vec![
                at("a2", "a", 3, 2),
                at("a1", "a", 0, 5),
                at("b1", "b", 1, 3),
            ],
        };
        normalize(&mut tl);
        // a2 rückt hinter a1; der andere Strang bleibt unberührt.
        assert_eq!(spans(&tl), vec![("a1", 0, 5), ("a2", 5, 2), ("b1", 1, 3)]);
    }

    #[test]
    fn negative_anfaenge_bleiben_und_laenge_ist_mindestens_eins() {
        let mut tl = Timeline {
            tracks: vec![track("a")],
            events: vec![at("a1", "a", -6, 0)],
        };
        normalize(&mut tl);
        assert_eq!(spans(&tl), vec![("a1", -6, 1)]);
    }

    #[test]
    fn slot_wird_nicht_mehr_geschrieben() {
        let mut tl = Timeline {
            tracks: vec![track("a")],
            events: vec![slotted("a1", "a", Some(1))],
        };
        normalize(&mut tl);
        let json = serde_json::to_string(&tl).unwrap();
        assert!(!json.contains("slot"));
        assert!(json.contains(r#""start":4"#));
    }
}
