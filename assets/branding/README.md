# App icon masters

`icon.svg` and `icon.png` are the current app icon masters. Update these files
in place; do not create separately named design variants. The current design
has a transparent background and viewBox `112 112 800 800` for a larger cube.
Generate platform icons from `icon.png`.

From the repository root (PowerShell):

```powershell
node node_modules/@tauri-apps/cli/tauri.js icon assets/branding/icon.png --output artifacts/generated-icons
$names = '32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico', 'icon.png'
foreach ($name in $names) {
  Copy-Item -LiteralPath "artifacts/generated-icons/$name" -Destination "src-tauri/icons/$name"
}
Copy-Item -LiteralPath assets/branding/icon.png -Destination public/icon.png
```

Tauri uses `src-tauri/icons` for native application/bundle icons. The frontend
uses `public/icon.png` as its favicon. Rebuild the native app to embed changed
platform icons; an already installed executable retains its previous icon.
