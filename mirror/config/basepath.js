// MagicMirror normally writes this file at startup; it is shipped read-only
// here because the container's config folder is mounted read-only.
globalThis.config = { basePath: "/mirror/" };
