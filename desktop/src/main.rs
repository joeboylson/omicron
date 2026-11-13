//! Omicron's desktop app: Omicron's web page in a window, on this computer
//! (ref/BRAINSTORM.md, "Two parts" and "What keeps sessions running").
//!
//! It's a window and nothing more. The page comes from `omicron serve` on
//! this computer, and the sessions run in Omicron's background program
//! (`omicron daemon` and the session host), so quitting the app leaves
//! them running. When the page or the daemon isn't running, the app starts
//! it, and it keeps running after the app quits. A visit from this
//! computer, as its owner, gets the Dev side of the page (the gate, and the
//! Dev view); the page itself checks that, not the app.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Where `omicron serve` listens here (`OMICRON_PORT` to change it).
fn port() -> u16 {
    std::env::var("OMICRON_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(9010)
}

/// The `omicron` program: `OMICRON_BIN`, else ~/.local/bin/omicron, else
/// whichever is on PATH.
fn omicron() -> PathBuf {
    if let Some(p) = std::env::var_os("OMICRON_BIN") {
        return p.into();
    }
    let local = PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/bin/omicron");
    if local.exists() {
        local
    } else {
        "omicron".into()
    }
}

fn listening(port: u16) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300)).is_ok()
}

/// Is a program with these words in its command line running?
fn running(words: &str) -> bool {
    Command::new("pgrep").args(["-f", words]).stdout(Stdio::null()).status().is_ok_and(|s| s.success())
}

/// Start an `omicron` command in the background, on its own: it carries on
/// after the app quits. Its output goes to ~/.omicron/<log>.
fn start(args: &[&str], log: &str) -> std::io::Result<()> {
    let home = PathBuf::from(std::env::var_os("OMICRON_HOME").unwrap_or_else(|| {
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".omicron").into_os_string()
    }));
    std::fs::create_dir_all(&home)?;
    let out = std::fs::OpenOptions::new().create(true).append(true).open(home.join(log))?;
    let mut cmd = Command::new("nohup");
    cmd.arg(omicron()).args(args).stdin(Stdio::null()).stdout(out.try_clone()?).stderr(out);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd.spawn()?;
    Ok(())
}

/// Make sure the page and the daemon run here. Returns the page's address,
/// or why it can't be shown.
fn ready() -> Result<String, String> {
    let port = port();
    if !running("omicron daemon") {
        if let Err(e) = start(&["daemon"], "daemon.log") {
            eprintln!("omicron-desktop: couldn't start the daemon: {e}");
        }
    }
    if !listening(port) {
        let p = port.to_string();
        start(&["serve", "--port", &p], "serve.log").map_err(|e| format!("couldn't start `omicron serve`: {e}"))?;
        let since = Instant::now();
        while !listening(port) {
            if since.elapsed() > Duration::from_secs(15) {
                return Err(format!(
                    "`omicron serve` didn't start on port {port}. ~/.omicron/serve.log says why; `omicron doctor` says what this computer still needs."
                ));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    Ok(format!("http://127.0.0.1:{port}/"))
}

/// A page that says what's wrong, when there's no Omicron page to show.
fn problem_page(why: &str) -> String {
    let why = why.replace('&', "&amp;").replace('<', "&lt;");
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Omicron</title><body style=\"font:15px -apple-system,system-ui;padding:40px;color:#333\"><h1>Omicron isn't ready on this computer</h1><p>{why}</p></body>"
    );
    format!("data:text/html,{}", html.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>())
}

fn main() {
    let url = ready().unwrap_or_else(|why| problem_page(&why));
    tauri::Builder::default()
        .setup(move |app| {
            let url = url.parse().expect("a page address");
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .title("Omicron")
                .inner_size(1280.0, 820.0)
                .min_inner_size(380.0, 500.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Omicron's window couldn't open");
}
