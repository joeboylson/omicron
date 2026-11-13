//! Text from the database, made safe to show in a terminal or type into a
//! Claude session. Anyone in a Project can write a title or comment; none
//! of it may move the cursor, clear the screen, change the terminal's
//! title, press keys in a session, or flip text around to hide what it
//! says. The web page reads the database itself and shows the text
//! exactly as written.

/// Characters that do something instead of showing: terminal and C1
/// controls, and the ones that reorder text (bidirectional overrides and
/// isolates). Line breaks and tabs are kept here; `line` handles them.
fn hidden(c: char) -> bool {
    (c.is_control() && c != '\n' && c != '\t') || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Safe to print: line breaks and tabs kept, everything that acts removed.
pub fn safe(s: &str) -> String {
    if !s.chars().any(hidden) {
        return s.to_string();
    }
    s.chars().filter(|c| !hidden(*c)).collect()
}

/// Safe, and on one line: line breaks and tabs become spaces.
pub fn line(s: &str) -> String {
    safe(s).replace(['\n', '\t'], " ")
}

/// Make every string in a JSON value safe, in place.
pub fn clean(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::String(s) => {
            if s.chars().any(hidden) {
                *s = safe(s);
            }
        }
        serde_json::Value::Array(a) => a.iter_mut().for_each(clean),
        serde_json::Value::Object(o) => o.values_mut().for_each(clean),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_acts_is_removed_and_what_shows_is_kept() {
        assert_eq!(safe("Buy 🥛 milk"), "Buy 🥛 milk");
        assert_eq!(safe("שלום عربى"), "שלום عربى");
        assert_eq!(safe("a\x1b[2Jb\x07c\x1b]0;title\x07d"), "a[2Jbc]0;titled");
        assert_eq!(safe("tab\there\nnext"), "tab\there\nnext");
        assert_eq!(safe("evil\u{202E}txt.exe"), "eviltxt.exe");
        assert_eq!(safe("c1\u{9b}31m"), "c131m");
        assert_eq!(safe("\r\x03\x7f"), "");
        assert_eq!(line("one\ntwo\tthree"), "one two three");
        let mut v = serde_json::json!({ "a": ["x\x1by", { "b": "ok" }], "n": 1 });
        clean(&mut v);
        assert_eq!(v, serde_json::json!({ "a": ["xy", { "b": "ok" }], "n": 1 }));
    }
}
