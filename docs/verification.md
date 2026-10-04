# Verification history

## Tab-scoped client session — 0.1.5

Client key now uses sessionStorage, replacing the earlier reset-on-reload behavior. Browser coverage: same-key auto-connect on reload/back-forward lifecycle, no automatic POST/file restoration, disconnect/401 removal, revoked stored key, transient 503 preserving the saved key, corrupt key removal and storage-denied memory-only fallback. Existing immutable same-ID retry, scoped options and admin browser cases still apply. API/server authentication and database schema are unchanged.

## Options and modal UX — 0.1.4

Local: 93 pytest tests, Ruff lint/format, JS syntax, wheel/sdist build and both browser suites against the final isolated installed wheel passed. Browser cases cover modal/dirty-close, 16k driver choices, multi-grant search/chips/keyboard, unchanged-grant revocation race, busy/duplicate/errors, persistent key modal, toast, default/override forms, constrained combinations, empty option rights, stale schema responses, immutable lost-response replay and fresh mobile screenshots. Actual FastAPI/SQLite + explicit FakeCups browser replay discarded an accepted 202 then replayed: exactly one durable job.

Real EDATEC read-only adapter probe passed under the service account: 14 Canon/CUPS options, 70 distinct PPD constraints, PageRegion excluded, reported PDF scaling choices and authenticated matching job13/completed metadata. No new print submission or queue mutation. Target installed-release tests remain a distinct rollout gate.

The serial independent review did not run after provider quota interrupted the UI worker. Parent completed the UI and manually audited adapter authentication/constraints, original-request digest compatibility, privileges, assets and modal state. This is not an independent-review certificate. Hardware duplex/scaling/fault/cancel/physical-copy tests are still separate.

## Client test page — 0.1.3

Local checks: **80 tests passed**, lint/format and both new JS syntax checks passed; one existing Starlette/httpx warning remains. Installed-wheel browser regressions passed for admin and client pages. Client coverage: key errors/empty grants, memory-only credential/reset, PDF/ZPL, XSS-safe text, slow/duplicate submits, immutable same-ID replay after a lost response, 422 edit recovery, advanced JSON, desktop/mobile and no external requests. Screenshots were inspected.

An additional installed-wheel browser check used actual FastAPI/SQLite with explicitly injected FakeCups, deliberately discarded an accepted HTTP 202 response and replayed the original request: exactly one durable job existed. No physical printer was involved. The read-only reviewer found no client-JS blocker, but did not inspect the route change fully or rerun tests; parent route/asset/security tests cover it.

The public `/client` page does not authenticate by itself; all data/mutations still require scoped API keys. No schema/CUPS/driver change. Target activation and physical printing are separate gates.


## CRUD and admin UX — 0.1.2

Local validation on 2026-10-04: **79 tests passed**, Ruff lint/format and JS syntax checks passed; one existing Starlette/httpx deprecation warning remains. New tests cover soft-delete migration, all nonterminal-job deletion blocks, history/idempotency preservation, revoked-key/deleted-resource access, concurrent acceptance/deletion, CUPS non-mutation and the new controls asset route.

The installed-wheel browser regression passed against a mocked 16k-driver catalogue with actual FastAPI asset/CSP routes: integrated explicit-selection combobox, keyboard/clear/Escape/refresh, safe text labels, help popovers, single add/import flow, 409/503 recovery, slow-request disabling/duplicate prevention, printer/client CRUD, unsaved edits, settings, logout and 390px mobile layout. Desktop/mobile screenshots were inspected. All four offline assets are packaged; installed-wheel protected endpoints reject unauthenticated requests.

A fresh read-only review found stale grant resubmission on client rename; the UI now omits unchanged `printer_ids`, with a browser regression for concurrent grant revocation plus explicit grant changes. No backend deletion blocker was found.

Target rollout and independent review are separate gates; local mocked evidence is not proof of physical printing. Follow docs/git-deployment.md for exact-commit parity, backup and soft-delete rollback cautions.

## Initial implementation record (0.1.0)

The sections below describe the original local-only checkpoint, not the current deployment status. EDATEC was subsequently staged, and the legacy gateway was removed with explicit authorization and off-device backup.

## Implementation present

- Python/FastAPI client API, one-admin session/CSRF web, scoped client keys and grants.
- SQLite metadata, hashed credentials, atomic request idempotency with independent tombstones, acceptance sequence FIFO and durable payloads.
- Real lazy pycups adapter using a local Unix socket; held handoff, correlation/job ID checks, PPD fingerprint and stop-printer policy checks.
- Bounded concurrent dispatch across printers, manual pause/full/individual resume, evidence-based cancel/unknown resolution, payload integrity checks and terminal cleanup.
- Offline Vietnamese admin assets, device/driver discovery, managed registration/import/edit, client permissions, job history/snapshot/details, retention/admission settings and credential-free mutation audit endpoint.
- CLI password bootstrap/reset and consistent SQLite backup; systemd unit and manual Linux staging/rollback instructions.

## Commands run on macOS

```sh
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
node --check src/print_appliance/static/app.js
uv build
uv run print-appliance --help
```

Measured test result: **63 passed**. One non-failing upstream Starlette/TestClient deprecation warning about httpx integration remains; production is unaffected by TestClient. The lockfile records the tested versions.

Regression coverage includes concurrent idempotency/admission, scope/CSRF/audit, PDF/ZPL validation, durable tombstones, FIFO during clock rollback, driver/URI mismatch, payload tampering, offline latch, full/individual resume, unconfirmed release, tracking a terminal job while paused, unknown/stopped/no-reprint, CUPS ID reuse, cancel correlation/evidence, unsafe error policy, WAL backup and single-worker locking. Tests use an explicitly injected fake CUPS backend or fake pycups connection; they do not send data to a printer.

Wheel/sdist build passed. Inspection confirmed the wheel contains the backend and all three offline web assets. An isolated wheel-install smoke passed: installed CLI entry point, offline asset routes and protected APIs.

## Browser smoke

Headless local Chrome via cached Playwright, served only on `127.0.0.1:18081`, with an explicitly injected fake backend. The installed executable has no fake-mode fallback.

Verified desktop/mobile login, empty state, discovery, printer registration, client grants, multipart acceptance and duplicate replay, job details/cancel, settings and logout. No JavaScript page errors or outbound resource requests. Mobile viewport 390px had no horizontal page overflow; the job table itself can scroll horizontally. Desktop and fresh-context mobile screenshots were inspected.

The smoke exposed and fixed a refresh race that erased selected printer grants. A first screenshot taken immediately after desktop-to-mobile viewport resizing had repeated compositor tiles; a fresh mobile context with GPU disabled produced the correct single-header rendering. This was screenshot capture behavior, not duplicated DOM.

## Not certified / remaining gates

- No SSH/deployment/configuration changes on EDATEC; the old service and Brother queue are untouched.
- Canon model, ARM driver, Raspberry Pi OS/Python ABI and real pycups installation/permissions are not verified.
- Real CUPS hold/release, error policy, printer offline/paper-out, partial output, physical copies and ZPL support require tests on a dedicated queue/printer. `completed` only means CUPS reports completed.
- No cloud/webhook/Internet or Odoo-specific integration changes. Odoo can adopt the documented client API in a separate integration step.
- CUPS 3/PPD-free provisioning and arbitrary vendor drivers are not certified. A non-raw queue must provide a readable PPD fingerprint; fail closed otherwise.
- App terminal cleanup removes **the application's payload**. CUPS may retain its own spool data/history according to global CUPS policy. Inventory `PreserveJobFiles`, `PreserveJobHistory`, disk usage and permissions before production; do not silently change shared CUPS retention on the old appliance.
- TLS/firewall/proxy rate/body/time limits and backups require target setup. The example service intentionally listens on loopback until reviewed LAN exposure.
- DB-only backup is not a complete spool restore. Stop the service and copy the complete private data directory for a consistent full backup.

## Recovery from implementation timeout

The implementation child timed out after 30 minutes; the planned independent reviewer did not run. Parent inspected partial changes, repaired an unfinished snapshot-schema change, added regression tests and manually reviewed the CUPS handoff/control paths. The result is a locally checked first implementation, not an independent-review certificate or hardware acceptance.
