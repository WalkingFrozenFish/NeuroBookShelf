# Installing NeuroBookShelf

**English** · [Русский](DISTRIBUTION.md)

## Download and run

Get the [latest release](https://github.com/WalkingFrozenFish/NeuroBookShelf/releases/latest):

| Platform | Asset | Run |
| --- | --- | --- |
| Windows x64 | `*-setup.exe` | Run the installer for your current user |
| Windows x64 portable | `*-windows-x64-portable.zip` | Extract to a writable folder and open `NeuroBookShelf.exe` |
| macOS Apple Silicon (M1 or newer) | `.dmg` | Drag NeuroBookShelf to Applications |

Python, OCR libraries and the translation engine are included. Git, Node.js, Rust and pip are not needed to use the app. The Windows installer installs WebView2 if it is missing; this requires internet access.

The published 0.1.0 release supports English → Russian translation and English OCR. Model files require about 199 MiB of initial downloads. You can skip this and read PDFs immediately. After model installation, OCR and translation work locally without an internet connection.

## Models in the next release

These features are in the development version and require a new application release:

- Open **Settings → OCR & translation**.
- Choose a source language, or automatic detection, and the target language.
- Find the required language pair in the table and download its model. Installed models are selected automatically for each fragment.
- The built-in catalog includes English ↔ Russian and French ↔ English. Refresh the upstream catalog to find more available pairs.
- Model downloads can be cancelled and retried. Completed files are retained.
- Download English OCR separately if you need to recognize scans. Other languages can be translated from PDF text layers; multilingual scan OCR is not included.

Queued jobs keep the translation direction selected when they were added. Existing saved translations are not automatically changed when you select another language.

The interface language (Russian/English) is a separate setting under **Settings → General**. Themes and custom colors are under **Appearance**. See the bilingual [user guide](docs/GUIDE.en.md) for all settings and library navigation.

## Data and portability

Regular installations store the library and models in:

- Windows: `%APPDATA%/com.locallibrary.reader/`.
- macOS: `~/Library/Application Support/com.locallibrary.reader/`.

Updates do not replace this directory. To back up, close the app and copy the entire data directory.

The Windows portable edition is identified by `portable.flag` next to the EXE. Its data is stored in `user-data/`. To move it, copy the entire extracted folder, including `runtime/`, `portable.flag` and `user-data/`. Library PDF paths are adjusted when the portable folder moves. `LLR_DATA_DIR` overrides the data root explicitly.

## First-launch system warnings

Windows builds currently have no publisher certificate. The operating system may identify the publisher as unknown.

macOS builds use an ad-hoc signature and are not notarized. macOS may warn or block the first launch. For normal public distribution, the maintainer needs Developer ID signing and notarization. A successful Windows build does not validate macOS installation.

Intel Macs and ready to use Linux packages are currently unsupported.

## Building installers

Use the [development setup](SETUP.md) and run:

```sh
npm ci
python scripts/build_runtime.py
npm run package:windows
python scripts/package_portable.py
```

The Windows installer is written under `src-tauri/target/release/bundle/nsis/`; the portable ZIP goes into `bundle/`. Neither `bundle/` nor `.distribution-cache/` belongs in Git. macOS packaging must run on an ARM64 Mac.

The release workflow builds Windows x64 and macOS ARM64, validates packaged Python, performs real OCR/translation smoke tests and checks assets and SHA-256 before publication. Ordinary pushes and PRs validate builds; a version tag from the default branch creates a public release after successful checks. See [release workflow details (Russian)](docs/WORKFLOW.md).

Never recreate an already published version tag. Before a release, update the application versions, release notes and landing pages together.
