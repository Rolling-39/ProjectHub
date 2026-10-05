#![windows_subsystem = "windows"]

mod ai;
mod commands;
mod github_fetch;
mod store;

use tauri::Manager;

fn main() {
    // 必须在 Builder 之前：白屏时靠这份日志判断执行到哪一步
    tauri_ui_kit::boot_log("project-manager", "启动", true);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // SQLite：app_data_dir/project-manager.db
            let dir = app.path().app_data_dir().expect("无法获取数据目录");
            std::fs::create_dir_all(&dir).expect("无法创建数据目录");
            let conn = store::init(&dir.join("project-manager.db")).expect("数据库初始化失败");
            app.manage(store::Db(std::sync::Mutex::new(conn)));

            // 启动 2.5 秒后探测页面是否加载，结果写 frontend.log
            tauri_ui_kit::spawn_ready_probe(app.handle(), "project-manager", "main", 2500);
            tauri_ui_kit::boot_log("project-manager", "setup 完成", false);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // kit 的 7 个命令（背景/窗口控制/日志）——背景由前端经 ui_kit_apply_backdrop
            // 统一应用，不要在 setup 里直接调 apply_acrylic
            tauri_ui_kit::commands::ui_kit_apply_backdrop,
            tauri_ui_kit::commands::ui_kit_clear_backdrop,
            tauri_ui_kit::commands::minimize_window,
            tauri_ui_kit::commands::toggle_maximize_window,
            tauri_ui_kit::commands::close_app_window,
            tauri_ui_kit::commands::js_log,
            tauri_ui_kit::commands::frontend_log_path,
            // 业务命令：pub fn 必须放在子模块（E0255 规则，见 kit README）
            commands::get_setting,
            commands::set_setting,
            commands::list_items,
            commands::list_tags,
            commands::upsert_item,
            commands::delete_item,
            commands::delete_items,
            commands::set_item_flags,
            commands::list_categories,
            commands::upsert_category,
            commands::delete_category,
            commands::open_item,
            commands::read_markdown,
            commands::find_readme,
            commands::list_markdown_files,
            commands::list_dir_files,
            commands::open_file,
            commands::search_all,
            commands::export_data,
            commands::import_data,
            commands::import_github_repo,
            commands::refresh_github_repo,
            commands::import_readme_manual,
            commands::scan_directory,
            commands::ai_test,
            commands::ai_calls,
            commands::ai_complete_item,
            commands::ai_organize,
            commands::ai_command,
            commands::ai_summarize_readme,
            commands::ai_save_suggestions,
            commands::ai_list_suggestions,
            commands::ai_apply_suggestions,
            commands::ai_undo_suggestion,
            commands::ai_discard_suggestions,
            commands::ai_clear_suggestions,
            commands::ai_set_group_name,
            commands::ai_chat,
            commands::ai_chat_history,
            commands::ai_chat_clear,
            commands::ai_get_prompts,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
