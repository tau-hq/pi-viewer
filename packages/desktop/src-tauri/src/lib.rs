//! Tau desktop shell: starts the Tau host as a sidecar, waits until it reports
//! its port, then opens the main window on that local URL. The web client is
//! served by the host itself, so the desktop app and the browser share one code path.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const DEV_HOST_URL: &str = "http://127.0.0.1:8787/";

fn resource_path(app: &AppHandle, relative: &str) -> Option<PathBuf> {
	let dir = app.path().resource_dir().ok()?;
	let candidate = dir.join(relative);
	if candidate.exists() {
		Some(candidate)
	} else {
		None
	}
}

fn open_window(app: &AppHandle, url: &str) {
	let parsed = url.parse().expect("valid host url");
	let result = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
		.title("Tau")
		.inner_size(1280.0, 820.0)
		.min_inner_size(900.0, 600.0)
		.build();
	if let Err(error) = result {
		log::error!("cannot open main window: {error}");
	}
}

/// Spawn the host sidecar. Returns false when the sidecar is unavailable (development
/// without bundled binaries), in which case the window connects to a host on the dev port.
async fn start_host(app: AppHandle) -> bool {
	let host_js = match resource_path(&app, "host/cli.mjs") {
		Some(path) => path,
		None => {
			log::warn!("host bundle not found in resources");
			return false;
		}
	};
	let client_dir = resource_path(&app, "client");
	let pi_bin = resource_path(&app, "pi/pi").or_else(|| resource_path(&app, "pi/pi.exe"));
	let node_pty = resource_path(&app, "node-pty");
	let extension = resource_path(&app, "extension/index.ts");
	let home = app.path().home_dir().unwrap_or_else(|_| PathBuf::from("."));

	// Node runs the host: node-pty (used by the terminals) only works under Node.
	let sidecar = match app.shell().sidecar("tau-node") {
		Ok(command) => command,
		Err(error) => {
			log::warn!("no tau-node sidecar: {error}");
			return false;
		}
	};
	let mut args: Vec<String> = vec![
		host_js.to_string_lossy().into_owned(),
		"--port".into(),
		"0".into(),
		"--cwd".into(),
		home.to_string_lossy().into_owned(),
		"--idle-minutes".into(),
		"0".into(),
	];
	if let Some(dir) = client_dir {
		args.push("--static".into());
		args.push(dir.to_string_lossy().into_owned());
	}
	if let Some(bin) = pi_bin {
		args.push("--pi-bin".into());
		args.push(bin.to_string_lossy().into_owned());
	}
	if let Some(pty) = node_pty {
		args.push("--node-pty".into());
		args.push(pty.to_string_lossy().into_owned());
	}
	if let Some(ext) = extension {
		args.push("--extension".into());
		args.push(ext.to_string_lossy().into_owned());
	}
	let (mut rx, _child) = match sidecar.args(args).spawn() {
		Ok(spawned) => spawned,
		Err(error) => {
			log::warn!("cannot spawn tau-node: {error}");
			return false;
		}
	};
	// The child is kept alive by the plugin's process registry and killed on app exit.
	while let Some(event) = rx.recv().await {
		match event {
			CommandEvent::Stdout(line) => {
				let text = String::from_utf8_lossy(&line);
				if let Some(json) = text.trim().strip_prefix("TAU_HOST_READY ") {
					if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
						if let Some(port) = value.get("port").and_then(|p| p.as_u64()) {
							let url = format!("http://127.0.0.1:{port}/");
							log::info!("tau-host ready on {url}");
							open_window(&app, &url);
							// Keep draining so the pipe never fills up.
							while let Some(later) = rx.recv().await {
								if let CommandEvent::Stderr(line) = later {
									log::debug!("tau-host: {}", String::from_utf8_lossy(&line).trim_end());
								}
							}
							return true;
						}
					}
				}
				log::info!("tau-host: {}", text.trim_end());
			}
			CommandEvent::Stderr(line) => log::warn!("tau-host: {}", String::from_utf8_lossy(&line).trim_end()),
			CommandEvent::Terminated(status) => {
				log::error!("tau-node exited early: {status:?}");
				return false;
			}
			_ => {}
		}
	}
	false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.setup(|app| {
			app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
			let handle = app.handle().clone();
			tauri::async_runtime::spawn(async move {
				if !start_host(handle.clone()).await {
					log::warn!("falling back to {DEV_HOST_URL}");
					open_window(&handle, DEV_HOST_URL);
				}
			});
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
