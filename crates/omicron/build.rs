//! Puts the built web page inside the `omicron` program, so a Web Machine is
//! still one file. Build the page first (`dev/web.sh`) and point
//! `OMICRON_WEB_DIST` at it. Without it, `omicron serve` shows a small
//! stand-in page instead.

use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-env-changed=OMICRON_WEB_DIST");
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("web_assets.rs");
    let mut code = String::from("pub static ASSETS: &[(&str, &[u8])] = &[\n");
    if let Some(dist) = env::var_os("OMICRON_WEB_DIST").filter(|d| !d.is_empty()) {
        let dist = Path::new(&dist);
        assert!(dist.join("index.html").is_file(), "OMICRON_WEB_DIST has no index.html: {}", dist.display());
        let mut files = Vec::new();
        collect(dist, dist, &mut files);
        files.sort();
        for (url, file) in files {
            println!("cargo:rerun-if-changed={file}");
            code.push_str(&format!("    ({url:?}, include_bytes!({file:?})),\n"));
        }
    }
    code.push_str("];\n");
    fs::write(out, code).unwrap();
}

fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, String)>) {
    println!("cargo:rerun-if-changed={}", dir.display());
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(root, &path, files);
        } else {
            let url = format!("/{}", path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
            files.push((url, fs::canonicalize(&path).unwrap().to_string_lossy().into_owned()));
        }
    }
}
