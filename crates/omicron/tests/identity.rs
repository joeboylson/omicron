use omicron::identity::{person_from_status, visitor, TailscalePerson, Visit};
use std::net::IpAddr;
use std::process::Command;

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn me() -> TailscalePerson {
    TailscalePerson { login: "someone@example.com".into(), display_name: "Some One".into() }
}

fn localhost() -> IpAddr {
    "127.0.0.1".parse().unwrap()
}

#[test]
fn reads_the_person_this_machine_belongs_to() {
    assert_eq!(person_from_status(&fixture("status-person.json")).unwrap(), me());
}

#[test]
fn tagged_machines_have_no_person() {
    let err = person_from_status(&fixture("status-tagged.json")).unwrap_err().to_string();
    assert!(err.contains("API key"), "{err}");
}

#[test]
fn signed_out_machines_have_no_person() {
    let err = person_from_status(&fixture("status-signed-out.json")).unwrap_err().to_string();
    assert!(err.contains("isn't signed in"), "{err}");
}

#[test]
fn a_visit_from_this_machine_is_this_machines_person() {
    let visit = visitor(localhost(), |_| None, || Ok(me())).unwrap();
    assert_eq!(visit, Visit::Local(me()));
}

#[test]
fn ipv6_localhost_counts_as_this_machine() {
    let visit = visitor("::1".parse().unwrap(), |_| None, || Ok(me())).unwrap();
    assert_eq!(visit, Visit::Local(me()));
}

#[test]
fn a_visit_through_tailscale_is_the_visitor() {
    let header = |name: &str| match name {
        "Tailscale-User-Login" => Some("other@example.com".to_string()),
        "Tailscale-User-Name" => Some("Other Person".to_string()),
        _ => None,
    };
    let visit = visitor(localhost(), header, || panic!("shouldn't look up this machine's person")).unwrap();
    assert_eq!(
        visit,
        Visit::Tailnet(TailscalePerson { login: "other@example.com".into(), display_name: "Other Person".into() })
    );
}

#[test]
fn a_blank_login_header_counts_as_no_header() {
    let header = |name: &str| (name == "Tailscale-User-Login").then(|| "  ".to_string());
    assert_eq!(visitor(localhost(), header, || Ok(me())).unwrap(), Visit::Local(me()));
}

#[test]
fn visits_from_other_addresses_are_refused() {
    let header = |_: &str| Some("other@example.com".to_string());
    let err = visitor("100.64.0.5".parse().unwrap(), header, || Ok(me())).unwrap_err().to_string();
    assert!(err.contains("refused"), "{err}");
}

#[test]
fn whoami_prints_this_machines_person() {
    let out = Command::new(env!("CARGO_BIN_EXE_omicron"))
        .arg("whoami")
        .env("OMICRON_TAILSCALE_STATUS", format!("{}/tests/fixtures/status-person.json", env!("CARGO_MANIFEST_DIR")))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "Some One (someone@example.com)");
}
