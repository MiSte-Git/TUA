# glib 0.18.5 security backport

Original: https://static.crates.io/crates/glib/glib-0.18.5.crate
SHA-256 (verified against the crates.io checksum recorded in Cargo.lock):
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`

The complete published archive is retained, including manifests and licenses.
Package version remains 0.18.5.

Backport: https://github.com/gtk-rs/gtk-rs-core/pull/2009/files
Commit: ea720152f28e293ef4362ee844ee5cc499f32d2a
Original fix: b5a4071e439bef2b5eea76c3aa25e5ae84839e34
Advisory: https://rustsec.org/advisories/RUSTSEC-2024-0429.html

Only two production-code changes in src/variant_iter.rs: make the output
pointer mutable and pass `&mut p` rather than `&p` to g_variant_get_child.
No API, dependency, feature or version changes. Added integration regression
test: tests/variant_str_iter_regression.rs (forward, backward, mixed iteration,
nth, nth_back, last, Unicode and empty strings/arrays).

Reproduce from src-tauri:
`cargo test --release --manifest-path vendor/glib-0.18.5/Cargo.toml --test variant_str_iter_regression`
Then run `cargo check --locked` and `npm run tauri build -- --bundles deb`
from the project root for the latter command.

This is a locally maintained backport, not an upstream 0.18 security release.
Version-based audit and Dependabot alerts may remain; no advisory is suppressed.
Track upstream releases and remove the patch only when every dependency path
uses a corrected supported release. Keep provenance and regression coverage
when refreshing this vendor directory. Debian's 0.18.5-7 independently carries
a fix: https://bugs.debian.org/1143114 .
