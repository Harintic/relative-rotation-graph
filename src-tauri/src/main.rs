use std::{
  net::TcpStream,
  path::PathBuf,
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::Duration,
};

use tauri::Manager;

struct BackendState(Mutex<Option<Child>>);

impl Drop for BackendState {
  fn drop(&mut self) {
    if let Some(mut child) = self.0.lock().ok().and_then(|mut guard| guard.take()) {
      let _ = child.kill();
    }
  }
}

fn wait_for_backend() {
  for _ in 0..100 {
    if TcpStream::connect("127.0.0.1:8765").is_ok() {
      return;
    }
    thread::sleep(Duration::from_millis(100));
  }
}

fn repo_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .expect("repo root not found")
    .to_path_buf()
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      if TcpStream::connect("127.0.0.1:8765").is_err() {
        let child = if cfg!(debug_assertions) {
          let python = repo_root().join(".venv/bin/python");
          Command::new(python)
            .args(["-m", "python_backend.server"])
            .current_dir(repo_root())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()?
        } else {
          let resource_dir = app.path().resource_dir().expect("resource dir not found");
          let backend_path = resource_dir.join("backend/rrg-backend");
          Command::new(backend_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?
        };

        wait_for_backend();
        app.manage(BackendState(Mutex::new(Some(child))));
      } else {
        app.manage(BackendState(Mutex::new(None)));
      }
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
