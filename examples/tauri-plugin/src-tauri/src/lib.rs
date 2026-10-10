//! A Tauri 2 application whose page uses the IceRoot SDK through its native plugin: the page
//! imports `@iceroot-network/sdk/tauri`, and keys, signing and node requests run in the plugin, in
//! Rust. The same code serves desktop (src/main.rs) and mobile, where the platform's project calls
//! the entry point.

/// Runs the application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = tauri::Builder::default()
        .plugin(tauri_plugin_iceroot::init())
        .run(tauri::generate_context!())
    {
        eprintln!("the application failed: {error}");
        std::process::exit(1);
    }
}
