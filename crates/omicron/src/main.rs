use anyhow::Result;
use omicron::identity;

const HELP: &str = "omicron: tasks, Projects, and Claude sessions in one tool

Usage: omicron <command>

Commands:
  whoami    Who this machine is signed in to Tailscale as
  help      Show this message";

fn main() {
    match run() {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("omicron: {e:#}");
            std::process::exit(1);
        }
    }
}

fn run() -> Result<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("whoami") => {
            let person = identity::local_person()?;
            println!("{} ({})", person.display_name, person.login);
            Ok(0)
        }
        None | Some("help") | Some("-h") | Some("--help") => {
            println!("{HELP}");
            Ok(0)
        }
        Some(other) => {
            eprintln!("omicron: no command called `{other}`\n\n{HELP}");
            Ok(2)
        }
    }
}
