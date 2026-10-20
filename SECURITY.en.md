# Security

**English** · [Русский](SECURITY.md)

Security fixes target the latest published release. Older versions do not receive a separate maintenance branch. Get current installers from [Releases](https://github.com/WalkingFrozenFish/NeuroBookShelf/releases/latest).

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/WalkingFrozenFish/NeuroBookShelf/security/advisories/new) when the **Report a vulnerability** button is available. Do not post a working exploit, private PDFs, library databases, tokens or full private file paths in public issues.

If private reporting is unavailable, open an issue asking the maintainer for a private contact channel, without technical vulnerability details. The maintainer is [@WalkingFrozenFish](https://github.com/WalkingFrozenFish). In a private report, include the version, OS, impact and anonymous reproduction steps. There is no guaranteed response time or bounty program.

## Local processing

Documents and library data stay on the computer. Internet access is required for WebView2 and model downloads and, in the development version, optional catalog refreshes. Bundled models use pinned HTTPS sources and SHA-256 verification. Additional catalog models use the official upstream catalog; downloaded packages retain source and checksum metadata. pip is used during builds, not on end users' computers.

Native libraries process PDFs and models. Local processing does not make every arbitrary PDF safe. Dependency updates, model sources and preservation of user data must be considered when reviewing changes.
