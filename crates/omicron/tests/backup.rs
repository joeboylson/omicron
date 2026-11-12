//! Backup and restore, for real: scripts/backup.sh makes a copy of the one
//! Supabase (database and uploaded images), scripts/restore.sh --scratch
//! puts it in a separate database, and the copy matches the real data,
//! table by table. Restoring over the real one is never done without a
//! typed "yes". In a file of its own, so nothing else changes the data
//! while the two are compared.
//!
//! Runs only on the Mac with the local Supabase (scripts/test.sh).

use std::path::Path;
use std::process::{Command, Stdio};

fn psql(db: &str, sql: &str) -> String {
    let o = Command::new("docker")
        .args(["exec", "-i", "omicron-supabase-db", "psql", "-U", "postgres", "-d", db, "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql])
        .output()
        .unwrap();
    assert!(o.status.success(), "psql: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

fn script(name: &str, args: &[&str], dir: &Path, input: &str) -> (bool, String) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut c = Command::new("bash")
        .arg(root.join("scripts").join(name))
        .args(args)
        .env("OMICRON_BACKUP_DIR", dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    c.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
    let o = c.wait_with_output().unwrap();
    (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
}

/// Row count and a fingerprint of every table Omicron keeps, in a database.
fn fingerprint(db: &str) -> Vec<String> {
    let tables = psql("postgres", "select tablename from pg_tables where schemaname = 'public' order by 1");
    tables
        .lines()
        .map(|t| {
            // Every row's contents, for tables whose rows don't change on
            // their own; just the count for those that do (machines check
            // in, sessions and the change list move along).
            let sql = match t {
                "machines" | "sessions" | "changes" | "people" | "tailscale_identities" => format!("select count(*) from public.{t}"),
                _ => format!("select count(*) || ' ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from public.{t} x"),
            };
            format!("{t}: {}", psql(db, &sql))
        })
        .collect()
}

#[test]
fn a_backup_restores_into_a_scratch_database_matching_the_real_one() {
    if std::env::var("OMICRON_TEST_PSQL").is_err() {
        eprintln!("skipped: needs the local Supabase (scripts/test.sh)");
        return;
    }
    let dir = std::env::temp_dir().join(format!("omicron-backup-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    let before = fingerprint("postgres");
    let tasks_before = psql("postgres", "select md5(coalesce(string_agg(id::text || title || coalesce(notes,''), '|' order by id), '')) from public.tasks");
    let objects = psql("postgres", "select count(*) from storage.objects where bucket_id = 'comment-images'");

    let (ok, out) = script("backup.sh", &[], &dir, "");
    assert!(ok, "{out}");
    let dumps: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    assert!(dumps.iter().any(|f| f.ends_with(".dump")) && dumps.iter().any(|f| f.ends_with("-files.tgz")), "{dumps:?}");
    assert!(!dumps.iter().any(|f| f.starts_with('.')), "no half-made copies left: {dumps:?}");

    // The images: every stored file is in the copy.
    let tgz = dir.join(dumps.iter().find(|f| f.ends_with("-files.tgz")).unwrap());
    let listed = Command::new("tar").arg("-tzf").arg(&tgz).output().unwrap();
    let files = String::from_utf8_lossy(&listed.stdout).lines().filter(|l| !l.ends_with('/')).count();
    assert!(files >= objects.parse::<usize>().unwrap(), "{files} files in the copy, {objects} stored");

    // Into a scratch database: the same rows as the real one.
    let (ok, out) = script("restore.sh", &["latest", "--scratch"], &dir, "");
    assert!(ok, "{out}");
    assert!(out.contains("Restored"), "{out}");
    let after = fingerprint("omicron_restore");
    assert_eq!(after, before, "the restored copy's tables differ from the real ones");
    let tasks_after = psql("omicron_restore", "select md5(coalesce(string_agg(id::text || title || coalesce(notes,''), '|' order by id), '')) from public.tasks");
    assert_eq!(tasks_after, tasks_before);

    // Over the real one: refused without a typed yes, and nothing changes.
    let (ok, out) = script("restore.sh", &["latest", "--real"], &dir, "no\n");
    assert!(!ok && out.contains("Left as it is."), "{out}");
    assert_eq!(fingerprint("postgres"), before);
    let (ok, out) = script("restore.sh", &["2001-01-01-0000", "--scratch"], &dir, "");
    assert!(!ok && out.contains("there's no copy"), "{out}");

    psql("postgres", "drop database if exists omicron_restore");
    std::fs::remove_dir_all(&dir).unwrap();
}
