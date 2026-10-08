//! Planungs-Tags: Rückverlinkung ("wo kommt Jonas vor?").

use crate::entities::{entity_doc_rel, Entity};
use crate::project::{detached_project, validate_id, AppState};
use serde::Serialize;
use std::fs;

// ---------------------------------------------------------------------------
// Planungs-Tags: Rückverlinkung
// ---------------------------------------------------------------------------
//
// Tags stehen als Markdown-Link mit eigenem Schema im Fließtext:
// `[Er](person:jonas-3f2a1b)`. Für die Rückrichtung ("wo kommt Jonas vor?")
// werden die Klartextdateien durchsucht. Bewusst kein Index: der Aufwand
// entspricht einem Suchindex-Rebuild und die Daten können nie veralten.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    /// "scene" | "character" | "location"
    pub source: String,
    pub source_id: String,
    pub source_title: String,
    /// Das getaggte Wort im Fließtext ("Er", "Seine", "Jonas", …).
    pub label: String,
    /// Umgebender Absatz als Vorschau (ohne Tag-Syntax).
    pub context: String,
}

struct FoundTag<'a> {
    label: &'a str,
    kind: &'a str,
    id: &'a str,
    /// Byte-Index hinter der schließenden Klammer.
    end: usize,
}

fn is_tag_kind(kind: &str) -> bool {
    matches!(kind, "person" | "location")
}

/// Liest einen Planungs-Tag, der an `start` mit '[' beginnt.
fn plan_tag_at(s: &str, start: usize) -> Option<FoundTag<'_>> {
    let rest = &s[start + 1..];
    let close = rest.find("](")?;
    let label = &rest[..close];
    if label.contains('[') {
        return None;
    }
    let target_start = start + 1 + close + 2;
    let paren = s[target_start..].find(')')?;
    let target = &s[target_start..target_start + paren];
    let (kind, id) = target.split_once(':')?;
    if !is_tag_kind(kind) || id.is_empty() {
        return None;
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return None;
    }
    Some(FoundTag {
        label,
        kind,
        id,
        end: target_start + paren + 1,
    })
}

/// Entfernt die Tag-Syntax aus einer Zeile, damit die Vorschau lesbar ist.
fn strip_plan_tags(line: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < line.len() {
        if line.as_bytes()[i] == b'[' {
            if let Some(tag) = plan_tag_at(line, i) {
                out.push_str(tag.label);
                i = tag.end;
                continue;
            }
        }
        let ch = line[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn shorten(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

fn collect_mentions(
    text: &str,
    kind: &str,
    id: &str,
    source: &str,
    source_id: &str,
    source_title: &str,
    out: &mut Vec<Mention>,
) {
    for line in text.lines() {
        let mut hits: Vec<&str> = Vec::new();
        let mut i = 0;
        while i < line.len() {
            if line.as_bytes()[i] == b'[' {
                if let Some(tag) = plan_tag_at(line, i) {
                    if tag.kind == kind && tag.id == id {
                        hits.push(tag.label);
                    }
                    i = tag.end;
                    continue;
                }
            }
            i += line[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        }
        if hits.is_empty() {
            continue;
        }
        let context = shorten(&strip_plan_tags(line), 180);
        for label in hits {
            out.push(Mention {
                source: source.to_string(),
                source_id: source_id.to_string(),
                source_title: source_title.to_string(),
                label: label.to_string(),
                context: context.clone(),
            });
        }
    }
}

/// Alle Fundstellen eines Planungs-Tags — in Szenen und den
/// Dokumenten anderer Personen/Orte.
#[tauri::command(async)]
pub fn list_mentions(
    tag_kind: String,
    id: String,
    state: tauri::State<AppState>,
) -> Result<Vec<Mention>, String> {
    if !is_tag_kind(&tag_kind) {
        return Err(format!("Unbekannte Tag-Art: {tag_kind}"));
    }
    validate_id(&id)?;
    // Liest alle Texte des Projekts — ohne den Lock zu halten.
    let p = &detached_project(&state)?;
    let mut out = Vec::new();

    for (scene_id, title) in crate::project::scene_titles(&p.meta.binder) {
        let Ok(text) = fs::read_to_string(p.abs(&crate::project::scene_rel_path(&scene_id))) else {
            continue;
        };
        collect_mentions(&text, &tag_kind, &id, "scene", &scene_id, &title, &mut out);
    }

    for (source, dir) in [("character", "characters"), ("location", "locations")] {
        let Ok(entries) = fs::read_dir(p.abs(dir)) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(entity) = serde_json::from_str::<Entity>(&raw) else {
                continue;
            };
            let Ok(text) = fs::read_to_string(p.abs(&entity_doc_rel(dir, &entity.id))) else {
                continue;
            };
            collect_mentions(
                &text,
                &tag_kind,
                &id,
                source,
                &entity.id,
                &entity.name,
                &mut out,
            );
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str =
        "Am Abend kam [Er](person:jonas-3f2a1b) durch [den Wald](location:wald-9c11ab).\n\
Später sah [ihn](person:jonas-3f2a1b) niemand mehr.\n\
Hier steht [ein Link](https://example.org) und [jemand anders](person:mara-11aa22).";

    fn mentions(kind: &str, id: &str) -> Vec<Mention> {
        let mut out = Vec::new();
        collect_mentions(TEXT, kind, id, "scene", "szene-aaa111", "Anfang", &mut out);
        out
    }

    #[test]
    fn findet_alle_fundstellen_einer_person() {
        let found = mentions("person", "jonas-3f2a1b");
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].label, "Er");
        assert_eq!(found[0].source_title, "Anfang");
        // Der Kontext zeigt den Satz ohne Tag-Syntax.
        assert_eq!(found[0].context, "Am Abend kam Er durch den Wald.");
        assert_eq!(found[1].label, "ihn");
    }

    #[test]
    fn trennt_arten_und_ids() {
        assert_eq!(mentions("location", "wald-9c11ab").len(), 1);
        assert_eq!(mentions("person", "mara-11aa22").len(), 1);
        // Gleiche ID, andere Art → keine Fundstelle.
        assert!(mentions("location", "jonas-3f2a1b").is_empty());
        assert!(mentions("person", "gibt-es-nicht").is_empty());
    }

    #[test]
    fn ignoriert_fremde_links() {
        assert!(plan_tag_at("[x](https://example.org)", 0).is_none());
        assert!(plan_tag_at("[x](unbekannt:abc)", 0).is_none());
        assert!(plan_tag_at("[x](person:)", 0).is_none());
        // IDs sind immer klein — Großbuchstaben deuten auf etwas anderes hin.
        assert!(plan_tag_at("[x](person:Jonas)", 0).is_none());
        assert!(plan_tag_at("[x](person:jonas-3f2a1b)", 0).is_some());
    }

    #[test]
    fn kuerzt_lange_kontexte() {
        let long = format!("{} [Er](person:jonas-3f2a1b)", "wort ".repeat(80));
        let mut out = Vec::new();
        collect_mentions(&long, "person", "jonas-3f2a1b", "scene", "s", "T", &mut out);
        assert_eq!(out.len(), 1);
        assert!(out[0].context.chars().count() <= 181, "{}", out[0].context);
        assert!(out[0].context.ends_with('…'));
    }

    #[test]
    fn kommt_mit_umlauten_klar() {
        let text = "Draußen stand [er](person:jonas-3f2a1b) – müde.";
        let mut out = Vec::new();
        collect_mentions(
            text,
            "person",
            "jonas-3f2a1b",
            "scene",
            "s",
            "Szene",
            &mut out,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].context, "Draußen stand er – müde.");
    }
}
