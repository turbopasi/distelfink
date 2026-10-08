mod entities;
mod export;
mod fsutil;
mod images;
mod layout;
mod mentions;
mod mindboard;
mod project;
mod search;
mod settings;
mod timeline;
mod trash;
mod versioning;

use project::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            project::create_project,
            project::open_project,
            project::close_project,
            project::save_project_as,
            project::read_scene,
            project::write_scene,
            project::create_node,
            project::rename_node,
            project::move_node,
            project::update_node_meta,
            project::duplicate_node,
            project::delete_node,
            project::check_external_changes,
            trash::list_trash,
            trash::count_trash,
            trash::restore_trash,
            trash::delete_trash_item,
            trash::empty_trash,
            entities::list_entities,
            entities::save_entity,
            entities::duplicate_entity,
            entities::delete_entity,
            entities::set_entity_image,
            entities::get_entity_image,
            entities::update_entity_meta,
            entities::read_entity_doc,
            entities::write_entity_doc,
            images::save_doc_image,
            images::import_doc_image,
            images::read_doc_image,
            mentions::list_mentions,
            timeline::load_timeline,
            timeline::save_timeline,
            mindboard::list_mindboards,
            mindboard::create_mindboard,
            mindboard::load_mindboard,
            mindboard::save_mindboard,
            mindboard::rename_mindboard,
            mindboard::delete_mindboard,
            mindboard::export_mindboard_png,
            search::search_project,
            versioning::snapshot,
            versioning::list_history,
            versioning::get_version,
            versioning::restore_version,
            export::templates::list_export_templates,
            export::templates::save_export_template,
            export::templates::delete_export_template,
            export::export_project,
            settings::load_settings,
            settings::save_settings,
            settings::import_background_image,
            settings::read_background_image,
            settings::clear_background_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
