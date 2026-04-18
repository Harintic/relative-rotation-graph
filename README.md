# Relative Rotation Graph Desktop

Local Tauri + React + Python rewrite of the Tkinter app.

## Current state

- Python backend extraction started in `python_backend/`
- React/Tauri scaffold started in `src/` and `src-tauri/`
- settings and download modes are wired as local app concepts

## Run

```bash
npm run tauri:dev
```

This starts:
- Vite for the React UI
- Tauri for the desktop shell
- the bundled Python sidecar in dev mode

## Setup

### On this machine
1. Clone the repo.
2. Install the Ubuntu prerequisites for Tauri and Rust.
3. Install Rust with `rustup`.
4. Create the Python venv.
5. Install Python deps.
6. Run `npm install`.
7. Start the app with `npm run tauri:dev`.

### On another device after `git pull`
1. Install system prerequisites:

```bash
sudo apt update
sudo apt install -y curl build-essential pkg-config libssl-dev libgtk-3-dev libpango1.0-dev libcairo2-dev libgdk-pixbuf2.0-dev libatk1.0-dev libglib2.0-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

2. Install Rust:

```bash
curl https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"
```

3. Create the Python venv:

```bash
python3 -m venv .venv
```

4. Install Python deps:

```bash
.venv/bin/pip install -r python_backend/requirements.txt
.venv/bin/pip install pyinstaller
```

5. Install Node deps:

```bash
npm install
```

6. Run the app:

```bash
npm run tauri:dev
```

## Notes

- `.venv/` is not committed to git.
- `node_modules/` is not committed to git.
- Build output is packaged as an Ubuntu `AppImage`.

## Next steps

1. Launch the Python sidecar from Tauri
2. Add native folder picker via Tauri dialog/plugin
3. Wire React to the sidecar on app startup
4. Bundle as Ubuntu AppImage
