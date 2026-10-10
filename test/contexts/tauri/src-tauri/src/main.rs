//! A Tauri 2 window whose page loads the IceRoot SDK's browser build and checks it against the
//! native vectors, and connects to a relay through the HTTP plugin's fetch. The page needs no
//! commands of its own.

fn main() {
    if let Err(error) = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
    {
        eprintln!("the application failed: {error}");
        std::process::exit(1);
    }
}
