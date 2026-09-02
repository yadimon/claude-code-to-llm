# Vision release verification

Verified against the repository on 2026-08-28.

- Vision support spans core image normalization, CLI input, nested Responses `input_image`, and core/server smoke scripts. Keep file, HTTPS, and embedded-base64 coverage together with MIME/signature and size/count validation.
- Run live vision checks with the repository's isolated Claude home. User-global extensions, plugins, or settings can change headless behavior and make a package failure look like an input failure.
- Prefer an embedded, visually unambiguous image for deterministic smoke tests. Treat an external URL as optional network evidence, not the only fixture.
- Before release, run the current `check`, `release:check`, and vision lanes. After registry publication, verify clean-installed core and server artifacts rather than relying only on the workspace checkout.
- Linux CI executes shebang fixtures directly; verify their Git mode is executable before tagging.
- Versions, tags, workflow outcomes, quota state, and external image availability are snapshots and must be rechecked.

