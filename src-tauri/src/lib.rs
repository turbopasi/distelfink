mod export;
mod mindboard;
mod project;
mod research;
mod search;
mod settings;
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
            research::list_entities,
            research::save_entity,
            research::duplicate_entity,
            research::delete_entity,
            research::set_entity_image,
            research::get_entity_image,
            research::update_entity_meta,
            research::read_entity_doc,
            research::write_entity_doc,
            research::save_doc_image,
            research::import_doc_image,
            research::read_doc_image,
            research::list_mentions,
            research::load_timeline,
            research::save_timeline,
            mindboard::list_mindboards,
            mindboard::create_mindboard,
            mindboard::load_mindboard,
            mindboard::save_mindboard,
            mindboard::rename_mindboard,
            mindboard::delete_mindboard,
            mindboard::write_mindboard_png,
            search::search_project,
            versioning::snapshot,
            versioning::list_history,
            versioning::get_version,
            versioning::restore_version,
            export::list_export_templates,
            export::save_export_template,
            export::delete_export_template,
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
