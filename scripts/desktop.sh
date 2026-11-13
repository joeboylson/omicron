#!/usr/bin/env bash
# Build Omicron's desktop app (desktop/, Tauri) and install it as
# ~/Applications/Omicron.app. Run on the Mac. The app is only a window:
# it shows `omicron serve` on this computer and starts it (and the daemon)
# if they're off, so install `omicron` first (dev/mac.sh).
set -euo pipefail
cd "$(dirname "$0")/../desktop"
cargo build --release
app="$HOME/Applications/Omicron.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp target/release/omicron-desktop "$app/Contents/MacOS/Omicron"
cp icons/icon.icns "$app/Contents/Resources/Omicron.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Omicron</string>
  <key>CFBundleDisplayName</key><string>Omicron</string>
  <key>CFBundleIdentifier</key><string>app.omicron.desktop</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>Omicron</string>
  <key>CFBundleIconFile</key><string>Omicron</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
echo "Installed $app"
