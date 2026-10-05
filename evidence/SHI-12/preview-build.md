# Isolated card preview build

`vite build --mode shinobi-preview` emits dist-preview/shinobi-camera-card.js and hashed chunks. The normal mode and resource names remain the upstream build. Runtime custom tags, event names, CSS, debug instances and legacy aliases are isolated. Bundled side-drawer, focus-trap and web-dialog and the action handler must also be namespaced: simply renaming the top-level card would collide.

Namespace rewriting occurs in renderChunk before output hashes/facades are emitted; dynamic imports remain inside that build. Repository documentation URLs are preserved. The separate preview suite serves both exact build outputs without transforming them, verifies existing constructors are retained, renders lazy live children in both cards, removes preview while the existing card remains usable, and selects synthetic 3840x2160 archive media plus a deleted-media failure through the built preview. Two built-browser smoke tests and five namespace decision tests pass.

Typecheck and 7,516 unit tests pass with all mandated src coverage thresholds at 100%; aggregate coverage includes two uninstrumented build-plugin hook statements, so aggregate statements are 99.98%. The plugin itself is exercised by the actual preview build/browser. Full browser/lint checks are pending this checkpoint. Supported original-device outcomes remain those in companion SHI-10; synthetic package smoke does not establish another HEVC platform.

Both resource/legacy names and custom-type migration are namespaced in this private preview; an existing ACC dashboard cannot be silently converted by loading it. See companion SHI-12 for artifact checksums, isolated install/upgrade/remove and authorization gates. Production services were not changed.
