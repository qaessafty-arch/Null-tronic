//! Desktop shell: serves the same Vite build as the web version and adds native
//! save/open dialogs (tauri-plugin-dialog + tauri-plugin-fs). Engineering logic stays in the
//! frontend; the optional Python service is started separately (see docs/installation).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running NULL-TECH CIRCUIT STUDIO");
}
