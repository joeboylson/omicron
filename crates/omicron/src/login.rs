//! Start `omicron daemon` when you log in: a launchd agent on macOS, a
//! systemd user service on Linux.
//!
//! The service restarts the daemon if it fails (no network yet at login,
//! say), but not when the daemon stops because its machine was switched off:
//! the service sets `OMICRON_DAEMON_SERVICE=1`, and then that stop counts as
//! a normal finish.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const SERVICE_ENV: &str = "OMICRON_DAEMON_SERVICE";
const LAUNCHD_LABEL: &str = "dev.omicron.daemon";
const SYSTEMD_UNIT: &str = "omicron-daemon.service";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum System {
    MacOs,
    Linux,
}

impl System {
    pub fn here() -> Result<System> {
        match std::env::consts::OS {
            "macos" => Ok(System::MacOs),
            "linux" => Ok(System::Linux),
            other => bail!("starting at login isn't supported on {other}"),
        }
    }
}

/// The service file: where it goes and what's in it.
pub struct ServiceFile {
    pub path: PathBuf,
    pub contents: String,
}

/// `omicron_home` is passed on to the daemon when it isn't the default
/// folder, so the service uses the same settings as this command.
pub fn service_file(system: System, user_home: &Path, exe: &Path, omicron_home: Option<&Path>, log: &Path) -> ServiceFile {
    match system {
        System::MacOs => {
            let mut env = format!("    <key>{SERVICE_ENV}</key><string>1</string>\n");
            if let Some(h) = omicron_home {
                env.push_str(&format!("    <key>OMICRON_HOME</key><string>{}</string>\n", xml(&h.to_string_lossy())));
            }
            ServiceFile {
                path: user_home.join("Library/LaunchAgents").join(format!("{LAUNCHD_LABEL}.plist")),
                contents: format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
{env}  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Restart it if it fails, but not after a normal stop. -->
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <!-- Each change is printed as a line; nothing reads them yet. -->
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
"#,
                    exe = xml(&exe.to_string_lossy()),
                    log = xml(&log.to_string_lossy()),
                ),
            }
        }
        System::Linux => {
            let mut env = format!("Environment={SERVICE_ENV}=1\n");
            if let Some(h) = omicron_home {
                env.push_str(&format!("Environment=\"OMICRON_HOME={}\"\n", systemd_quote(&h.to_string_lossy())));
            }
            ServiceFile {
                path: user_home.join(".config/systemd/user").join(SYSTEMD_UNIT),
                contents: format!(
                    "[Unit]\n\
                     Description=Omicron daemon: keeps this machine awake in Omicron and follows changes\n\
                     \n\
                     [Service]\n\
                     ExecStart=\"{exe}\" daemon\n\
                     {env}\
                     Restart=on-failure\n\
                     RestartSec=30\n\
                     StandardOutput=null\n\
                     StandardError=append:{log}\n\
                     \n\
                     [Install]\n\
                     WantedBy=default.target\n",
                    exe = systemd_quote(&exe.to_string_lossy()),
                    log = log.to_string_lossy(),
                ),
            }
        }
    }
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn systemd_quote(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// The file for this machine and this `omicron` program.
pub fn this_service_file() -> Result<ServiceFile> {
    let system = System::here()?;
    let user_home = PathBuf::from(std::env::var_os("HOME").context("HOME isn't set")?);
    let exe = std::env::current_exe()?.canonicalize()?;
    let omicron_home = std::env::var_os("OMICRON_HOME").filter(|h| !h.is_empty()).map(PathBuf::from);
    let omicron_home = match omicron_home {
        Some(h) => Some(std::path::absolute(h)?),
        None => None,
    };
    let log = crate::config::home()?.join("daemon.log");
    Ok(service_file(system, &user_home, &exe, omicron_home.as_deref(), &log))
}

/// Write the service file and start it now. Safe to run twice: it replaces
/// the old one, which picks up a moved `omicron` program.
pub fn start_at_login() -> Result<PathBuf> {
    let file = this_service_file()?;
    std::fs::create_dir_all(file.path.parent().unwrap())?;
    std::fs::create_dir_all(crate::config::home()?)?;
    match System::here()? {
        System::MacOs => {
            let target = launchd_target()?;
            // Stop the old one if it's loaded; an error just means it wasn't.
            let _ = Command::new("launchctl").args(["bootout", &format!("{target}/{LAUNCHD_LABEL}")]).output();
            std::fs::write(&file.path, &file.contents)?;
            run("launchctl", &["bootstrap", &target, &file.path.to_string_lossy()])?;
        }
        System::Linux => {
            std::fs::write(&file.path, &file.contents)?;
            run("systemctl", &["--user", "daemon-reload"])?;
            run("systemctl", &["--user", "enable", SYSTEMD_UNIT])?;
            run("systemctl", &["--user", "restart", SYSTEMD_UNIT])?;
        }
    }
    Ok(file.path)
}

/// Stop it and remove the service file. Fine if it was never set up.
pub fn stop_at_login() -> Result<Option<PathBuf>> {
    let file = this_service_file()?;
    match System::here()? {
        System::MacOs => {
            let _ = Command::new("launchctl").args(["bootout", &format!("{}/{LAUNCHD_LABEL}", launchd_target()?)]).output();
        }
        System::Linux => {
            let _ = Command::new("systemctl").args(["--user", "disable", "--now", SYSTEMD_UNIT]).output();
        }
    }
    if !file.path.exists() {
        return Ok(None);
    }
    std::fs::remove_file(&file.path)?;
    if System::here()? == System::Linux {
        let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
    }
    Ok(Some(file.path))
}

fn launchd_target() -> Result<String> {
    let out = Command::new("id").arg("-u").output().context("couldn't run `id -u`")?;
    Ok(format!("gui/{}", String::from_utf8_lossy(&out.stdout).trim()))
}

fn run(program: &str, args: &[&str]) -> Result<()> {
    let out = Command::new(program).args(args).output().with_context(|| format!("couldn't run {program}"))?;
    if !out.status.success() {
        bail!("{program} {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launchd_agent_runs_the_daemon_and_keeps_it_going() {
        let f = service_file(
            System::MacOs,
            Path::new("/Users/pat"),
            Path::new("/opt/omicron & co/omicron"),
            None,
            Path::new("/Users/pat/.omicron/daemon.log"),
        );
        assert_eq!(f.path, Path::new("/Users/pat/Library/LaunchAgents/dev.omicron.daemon.plist"));
        assert!(f.contents.contains("<string>/opt/omicron &amp; co/omicron</string>\n    <string>daemon</string>"));
        assert!(f.contents.contains("<key>OMICRON_DAEMON_SERVICE</key><string>1</string>"));
        assert!(f.contents.contains("<key>SuccessfulExit</key><false/>"));
        assert!(!f.contents.contains("OMICRON_HOME"));
    }

    #[test]
    fn systemd_service_runs_the_daemon_and_keeps_it_going() {
        let f = service_file(
            System::Linux,
            Path::new("/home/pat"),
            Path::new("/usr/local/bin/omicron"),
            Some(Path::new("/srv/omicron")),
            Path::new("/srv/omicron/daemon.log"),
        );
        assert_eq!(f.path, Path::new("/home/pat/.config/systemd/user/omicron-daemon.service"));
        assert!(f.contents.contains("ExecStart=\"/usr/local/bin/omicron\" daemon\n"));
        assert!(f.contents.contains("Environment=OMICRON_DAEMON_SERVICE=1\n"));
        assert!(f.contents.contains("Environment=\"OMICRON_HOME=/srv/omicron\"\n"));
        assert!(f.contents.contains("Restart=on-failure\n"));
        assert!(f.contents.contains("StandardError=append:/srv/omicron/daemon.log\n"));
        assert!(f.contents.contains("WantedBy=default.target\n"));
    }
}
