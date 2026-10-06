# Original single-file download validation

The card advertises Download only for a Shinobi recording with the validated adapter flag. It resolves a new media-source download ID through HA and performs the same bounded signed GET Range preflight as playback. The existing card native download helper streams the attachment without buffering a recording into a Blob. Legacy adapters without the flag remain disabled; tests cover true/false/missing support and malformed identifiers.

7,522 unit tests pass with all mandated source coverage thresholds at 100%; 215 Chromium browser regressions pass. Typecheck, lint and build pass. The dedicated browser suite uses the actual rendered normal Download control and a real Playwright download of the committed synthetic4K fixture. Its SHA-256 matches the source and the filename is safe. The owned synthetic download is removed after verification. No actual residential footage is saved.

HA original-byte/access/filename/Range/deleted/cancellation and 64 MiB bounded-memory checks are in companion SHI-13. Physical iPhone downloads and current-head/dependency reviews remain open; this is not incident preservation or cross-file/trim export. The preview build retains its separate namespace/resource.

Run corepack yarn@4.9.1 vitest run --config vitest.download.config.ts. This dedicated suite is excluded from ordinary source browser runs because it requires native download capture commands; all its media are checked-in synthetic fixtures.
