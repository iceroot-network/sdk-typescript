//! A Tauri 2 window whose page loads the IceRoot SDK's browser build and checks it against the
//! native vectors. The page needs no commands: everything runs in the webview.

fn main() {
    if let Err(error) = tauri::Builder::default().run(tauri::generate_context!()) {
        eprintln!("the application failed: {error}");
        std::process::exit(1);
    }
}
