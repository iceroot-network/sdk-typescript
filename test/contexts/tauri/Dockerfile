# Build and WebDriver environment for the Tauri checks on Linux (WebKitGTK): Rust, the WebKitGTK
# development files, WebKitWebDriver, tauri-driver, a virtual display and Node. The toolchain of
# sdk-rust (its rust-toolchain.toml) with clippy and rustfmt, for the Tauri plugin's own checks.
FROM rust:1.98-trixie

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev libssl-dev \
      webkit2gtk-driver xvfb xauth dbus dbus-x11 nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN cargo install tauri-driver --version "^2" --locked

RUN rustup toolchain install 1.98.0 --profile minimal --component clippy,rustfmt --target wasm32-unknown-unknown
