//! The session host: runs a program (a Claude session) in the background in
//! a terminal of its own, so you can jump in and out of it later. Like
//! dtach, built into Omicron; no tmux needed.
//!
//! Each hosted session is one detached `omicron` process that owns the
//! program's terminal (a pseudo-terminal) and a socket at
//! `~/.omicron/run/<name>.sock`, readable only by this user. It keeps the
//! last part of the output, so someone jumping in sees where things are. It
//! doesn't depend on the daemon: restarting the daemon leaves it running.
//! When the program exits, the host removes its socket and stops.
//!
//! The socket's protocol: the host sends the terminal's output as plain
//! bytes (first the kept output, then live). A client sends frames of
//! `[kind: u8][length: u32 big-endian][data]`: kind 0 is input for the
//! terminal, kind 1 is a new size (rows, cols as two u16), kind 2 lets go
//! of everyone jumped in (`omicron detach`, from inside the session).
//!
//! The program runs with `OMICRON_SESSION` set to its name, so a command
//! inside it knows which session it's in.

use anyhow::{bail, Context, Result};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

/// How much recent output is kept to show someone who jumps in.
const KEEP: usize = 256 * 1024;
pub const INPUT: u8 = 0;
pub const RESIZE: u8 = 1;
pub const DETACH: u8 = 2;
/// Ctrl-\ detaches, as in dtach.
pub const DETACH_KEY: u8 = 0x1c;

pub fn run_dir() -> Result<PathBuf> {
    Ok(crate::config::home()?.join("run"))
}

fn check_name(name: &str) -> Result<()> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) || name.starts_with('.') {
        bail!("a session name is letters, numbers, - _ and . (like `parser-work`)");
    }
    Ok(())
}

pub fn socket_path(name: &str) -> Result<PathBuf> {
    check_name(name)?;
    let path = run_dir()?.join(format!("{name}.sock"));
    // Unix sockets have a short length limit (about 100 characters).
    if path.as_os_str().len() > 100 {
        bail!("the session's socket path is too long ({}). Use a shorter session name or OMICRON_HOME.", path.display());
    }
    Ok(path)
}

/// Is a host for `name` running and answering?
pub fn is_running(name: &str) -> bool {
    socket_path(name).ok().is_some_and(|p| UnixStream::connect(p).is_ok())
}

/// The hosted sessions on this machine that are running. Sockets left by a
/// host that died are cleaned up.
pub fn hosted() -> Result<Vec<String>> {
    let mut names = Vec::new();
    let Ok(entries) = std::fs::read_dir(run_dir()?) else { return Ok(names) };
    for e in entries.flatten() {
        let path = e.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".sock")) else { continue };
        if UnixStream::connect(&path).is_ok() {
            names.push(name.to_string());
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
    names.sort();
    Ok(names)
}

/// Start `command` in a new detached host called `name`, in `folder`.
/// Returns once the host is answering.
pub fn start(name: &str, folder: &std::path::Path, command: &[String], env: &[(String, String)]) -> Result<()> {
    check_name(name)?;
    if command.is_empty() {
        bail!("nothing to run");
    }
    if is_running(name) {
        bail!("a session called {name} is already running here");
    }
    // Claude would first ask whether to trust the folder, with nobody here
    // to answer: mark it trusted (see `trust`).
    if std::path::Path::new(&command[0]).file_name().is_some_and(|f| f == "claude") {
        crate::trust::trust(folder)?;
    }
    let dir = run_dir()?;
    std::fs::create_dir_all(&dir)?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let exe = std::env::current_exe()?;
    let mut cmd = Command::new(exe);
    cmd.args(["sessions", "host-run", name, "--"]).args(command).current_dir(folder);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // Its own session, so it outlives this terminal and the daemon.
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            nix::unistd::setsid().map_err(std::io::Error::from)?;
            Ok(())
        });
    }
    cmd.spawn().context("couldn't start the session host")?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while std::time::Instant::now() < deadline {
        if is_running(name) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    bail!("the session host for {name} didn't start")
}

/// The host itself (`omicron sessions host-run`): runs until the program
/// exits.
pub fn host(name: &str, command: &[String]) -> Result<()> {
    let socket = socket_path(name)?;
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).context("couldn't open the session's socket")?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
    }

    let size = nix::pty::Winsize { ws_row: 40, ws_col: 120, ws_xpixel: 0, ws_ypixel: 0 };
    let pty = nix::pty::openpty(Some(&size), None).context("couldn't make a terminal")?;
    let master: OwnedFd = pty.master;
    let slave: OwnedFd = pty.slave;
    let mut cmd = Command::new(&command[0]);
    cmd.args(&command[1..]).env("TERM", std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".into())).env("OMICRON_SESSION", name);
    cmd.stdin(Stdio::from(slave.try_clone()?)).stdout(Stdio::from(slave.try_clone()?)).stderr(Stdio::from(slave));
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            nix::unistd::setsid().map_err(std::io::Error::from)?;
            // Make the terminal this program's own (its controlling terminal).
            if nix::libc::ioctl(0, nix::libc::TIOCSCTTY as _, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = cmd.spawn().with_context(|| format!("couldn't run {}", command[0]))?;

    let master = Arc::new(master);
    let kept: Arc<Mutex<Vec<u8>>> = Arc::default();
    let clients: Arc<Mutex<Vec<UnixStream>>> = Arc::default();

    // Output: keep the last part, and pass it to everyone attached.
    {
        let (master, kept, clients) = (master.clone(), kept.clone(), clients.clone());
        std::thread::spawn(move || {
            let mut reader = std::fs::File::from(master.try_clone().expect("terminal"));
            let mut buf = [0u8; 8192];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let chunk = &buf[..n];
                {
                    let mut k = kept.lock().unwrap();
                    k.extend_from_slice(chunk);
                    if k.len() > KEEP {
                        let cut = k.len() - KEEP;
                        k.drain(..cut);
                    }
                }
                clients.lock().unwrap().retain_mut(|c| c.write_all(chunk).is_ok());
            }
        });
    }

    // People jumping in.
    {
        let (master, kept, clients) = (master.clone(), kept.clone(), clients.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut out = match stream.try_clone() {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                // Kept output first, while holding the list so nothing is
                // sent twice or missed.
                {
                    let mut list = clients.lock().unwrap();
                    if out.write_all(&kept.lock().unwrap()).is_ok() {
                        list.push(out);
                    }
                }
                let (master, clients) = (master.clone(), clients.clone());
                std::thread::spawn(move || serve_client(stream, &master, &clients));
            }
        });
    }

    let status = child.wait()?;
    let _ = std::fs::remove_file(&socket);
    std::process::exit(status.code().unwrap_or(0));
}

/// Read one client's frames: input goes to the terminal, sizes resize it,
/// and a detach lets go of everyone jumped in.
fn serve_client(mut stream: UnixStream, master: &OwnedFd, clients: &Mutex<Vec<UnixStream>>) {
    let mut writer = match master.try_clone() {
        Ok(fd) => std::fs::File::from(fd),
        Err(_) => return,
    };
    loop {
        let mut head = [0u8; 5];
        if stream.read_exact(&mut head).is_err() {
            return;
        }
        let len = u32::from_be_bytes([head[1], head[2], head[3], head[4]]) as usize;
        if len > 1 << 20 {
            return;
        }
        let mut data = vec![0u8; len];
        if stream.read_exact(&mut data).is_err() {
            return;
        }
        match head[0] {
            INPUT => {
                if writer.write_all(&data).is_err() {
                    return;
                }
            }
            RESIZE if data.len() == 4 => {
                let size = nix::pty::Winsize {
                    ws_row: u16::from_be_bytes([data[0], data[1]]),
                    ws_col: u16::from_be_bytes([data[2], data[3]]),
                    ws_xpixel: 0,
                    ws_ypixel: 0,
                };
                unsafe {
                    nix::libc::ioctl(master.as_raw_fd(), nix::libc::TIOCSWINSZ as _, &size);
                }
            }
            DETACH => {
                for c in clients.lock().unwrap().drain(..) {
                    let _ = c.shutdown(std::net::Shutdown::Both);
                }
            }
            _ => {}
        }
    }
}

/// Let go of everyone jumped into the session `name` (it keeps running).
pub fn detach(name: &str) -> Result<()> {
    let mut s = connect(name)?;
    s.write_all(&frame(DETACH, &[]))?;
    Ok(())
}

pub fn frame(kind: u8, data: &[u8]) -> Vec<u8> {
    let mut f = Vec::with_capacity(5 + data.len());
    f.push(kind);
    f.extend_from_slice(&(data.len() as u32).to_be_bytes());
    f.extend_from_slice(data);
    f
}

fn connect(name: &str) -> Result<UnixStream> {
    UnixStream::connect(socket_path(name)?).with_context(|| format!("no session called {name} is running on this machine"))
}

/// Type `text` into a hosted session, as if at its keyboard.
pub fn send(name: &str, text: &str) -> Result<()> {
    let mut s = connect(name)?;
    s.write_all(&frame(INPUT, text.as_bytes()))?;
    Ok(())
}

/// Type a message into a hosted session and press Enter to send it.
///
/// Claude Code takes text that arrives all at once as pasted, and an Enter
/// inside a paste becomes a new line instead of sending. So the text goes
/// first and Enter a moment later, on its own. Only one message is typed
/// into a session at a time (a lock per session), so two senders can't mix
/// their keys together.
pub fn say(name: &str, text: &str) -> Result<()> {
    use std::os::fd::AsRawFd;
    let text = text.trim_end_matches(['\r', '\n']);
    // Running at all? (Says so plainly if not.)
    drop(connect(name)?);
    let lock_path = run_dir()?.join(format!("{name}.typing"));
    let lock = std::fs::OpenOptions::new().create(true).write(true).truncate(false).open(&lock_path)?;
    // Wait for any other sender to finish (released when `lock` is dropped).
    if unsafe { nix::libc::flock(lock.as_raw_fd(), nix::libc::LOCK_EX) } != 0 {
        bail!("couldn't wait for {name}'s keyboard");
    }
    if !text.is_empty() {
        send(name, text)?;
        std::thread::sleep(std::time::Duration::from_millis(300 + (text.len() as u64 / 50).min(1200)));
    }
    send(name, "\r")?;
    // Let it take the message before the next sender types.
    std::thread::sleep(std::time::Duration::from_millis(200));
    drop(lock);
    Ok(())
}

/// Jump into a hosted session in this terminal until Ctrl-\ (or the
/// session ends). Returns true if the session ended.
pub fn attach(name: &str) -> Result<bool> {
    use nix::sys::termios;
    let stream = connect(name)?;
    let stdin = std::io::stdin();
    let saved = termios::tcgetattr(&stdin).context("attach needs a terminal")?;
    let mut raw = saved.clone();
    termios::cfmakeraw(&mut raw);
    termios::tcsetattr(&stdin, termios::SetArg::TCSANOW, &raw)?;
    let restore = || {
        let _ = termios::tcsetattr(&std::io::stdin(), termios::SetArg::TCSANOW, &saved);
    };

    let size_of_terminal = || -> Option<[u8; 4]> {
        let mut ws: nix::libc::winsize = unsafe { std::mem::zeroed() };
        let ok = unsafe { nix::libc::ioctl(1, nix::libc::TIOCGWINSZ as _, &mut ws) } == 0;
        ok.then(|| {
            let mut b = [0u8; 4];
            b[..2].copy_from_slice(&ws.ws_row.to_be_bytes());
            b[2..].copy_from_slice(&ws.ws_col.to_be_bytes());
            b
        })
    };

    // Output from the session to this terminal; ends when the session does.
    let ended = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut from = stream.try_clone()?;
        let ended = ended.clone();
        std::thread::spawn(move || {
            let mut out = std::io::stdout();
            let mut buf = [0u8; 8192];
            while let Ok(n) = from.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let _ = out.write_all(&buf[..n]);
                let _ = out.flush();
            }
            ended.store(true, std::sync::atomic::Ordering::SeqCst);
        });
    }
    // Keep the session's size matched to this terminal's.
    {
        let mut to = stream.try_clone()?;
        let ended = ended.clone();
        std::thread::spawn(move || {
            let mut last = None;
            while !ended.load(std::sync::atomic::Ordering::SeqCst) {
                let now = size_of_terminal();
                if now.is_some() && now != last {
                    if to.write_all(&frame(RESIZE, &now.unwrap())).is_err() {
                        return;
                    }
                    last = now;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
    }
    // Keys to the session, until Ctrl-\ .
    let mut to = stream;
    let mut input = std::io::stdin().lock();
    let mut buf = [0u8; 1024];
    let mut detached = false;
    while !ended.load(std::sync::atomic::Ordering::SeqCst) {
        let mut fds = [nix::poll::PollFd::new(std::os::fd::AsFd::as_fd(&input), nix::poll::PollFlags::POLLIN)];
        if nix::poll::poll(&mut fds, nix::poll::PollTimeout::from(200u16)).unwrap_or(0) == 0 {
            continue;
        }
        let n = match input.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let (keys, stop) = match buf[..n].iter().position(|&b| b == DETACH_KEY) {
            Some(i) => (&buf[..i], true),
            None => (&buf[..n], false),
        };
        if !keys.is_empty() && to.write_all(&frame(INPUT, keys)).is_err() {
            break;
        }
        if stop {
            detached = true;
            break;
        }
    }
    restore();
    // Let go of from inside (`omicron detach`): the session still runs.
    // (When it ended instead, its socket goes a moment after its output.)
    if !detached {
        std::thread::sleep(std::time::Duration::from_millis(300));
        detached = is_running(name);
    }
    if detached {
        eprintln!("\r\n[detached from {name}: `omicron sessions attach {name}` to jump back in]");
    }
    Ok(!detached)
}
