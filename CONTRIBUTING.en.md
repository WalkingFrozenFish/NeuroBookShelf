# Contributing

**English** · [Русский](CONTRIBUTING.md)

Use [Issues](https://github.com/WalkingFrozenFish/NeuroBookShelf/issues/new/choose) for bugs, ideas and questions. English and Russian are welcome. Before a large change, describe the intended behavior in an issue so the scope can be discussed.

## Workflow

1. Update the default branch (`master`) with a fast-forward pull.
2. Create a short lived branch. Use `feature/`, `fix/`, `docs/` or `chore/`; Codex changes use `codex/`.
3. Implement one coherent change, run relevant checks and push the branch.
4. Open a PR targeting `master`. Describe the problem, resulting behavior and validation. Drafts are welcome for unfinished work.
5. Wait for the required **CI** check, including Windows and macOS packaging. The maintainer merges using **Squash and merge**.
6. Delete the merged branch and update your local default branch.

Workflows support both `master` and `main`; renaming is not necessary. External contributors use fork → branch → PR. PR code does not receive signing secrets or release publication permissions.

## Checks

Development requirements are documented in [SETUP.md](SETUP.md) (Russian). Node.js 22, stable Rust and development Python 3.10–3.12 are required. Packaged builds carry their own Python.

```sh
npm ci
npm test
npm run build
python scripts/check_version.py
python -m unittest discover -s tests -p 'test_*.py'
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -- --skip worker::tests
```

Worker protocol tests require a configured development Python. CI tests real worker/OCR/translation using packaged Python. See [tests/README.md](tests/README.md) for browser and optional language-pair checks.

Do not commit models, runtime bundles, user PDFs, databases, tokens or installers. Commit lockfiles when dependencies change. Changes to Python libraries and models require pinned dependencies/manifests, retained notices and real OCR/translation checks on supported platforms.

For bug fixes, prefer a regression test. For UI changes, describe manual validation and include a screenshot without private content. Keep library compatibility; use database migrations when the schema changes.

## Documentation and translation

Update relevant documentation and the **Unreleased** changelog when user-visible behavior changes. Version numbers are changed separately when preparing a release. Keep both README and landing languages in sync.

Wrap user-facing interface strings with `t()` and add the English entry in `src/locales/en.json`. `npm test` checks literal Russian translation keys for missing English entries. Do not translate users' book titles, notes or document contents as interface labels.

Follow `.editorconfig` and use commit messages that explain the change. Conventional prefixes are optional; commit messages do not determine release versions automatically.

## License and communication

Source contributions follow the project's AGPL-3.0-only license. Third-party libraries and model files keep their own licenses; preserve notices and review terms before adding them.

Discuss behavior and code respectfully. [@WalkingFrozenFish](https://github.com/WalkingFrozenFish) maintains the project, sets release scope and decides what to merge. Response and fix times are not guaranteed.
