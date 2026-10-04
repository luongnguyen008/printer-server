# Git-based updates: Mac and EDATEC

## Rule

Edit and test on Mac, commit/push to `https://github.com/luongnguyen008/printer-server`, then deploy **that exact commit** to EDATEC. The repository is public by user request. Never patch only the device's JS/HTML/Python files. Runtime data, credentials and private backups remain outside Git.

A matching source checkout is not enough: verify the installed package assets/modules match `src/print_appliance` from that commit. Keep the previous wheel for rollback. Build/upload a complete wheel; do not replace individual assets.

## Current paths

- Mac source: `/Users/luongnguyen/work/printer-server`.
- EDATEC source checkout: `/opt/print-appliance/source` (root-controlled).
- EDATEC runtime: `/opt/print-appliance/.venv`; data: `/var/lib/print-appliance`.
- Running release identifier: `/opt/print-appliance/SOURCE_COMMIT`.
- New service: `print-appliance`; retain existing service configuration, service user and CUPS policy when updating only application code.
- The legacy `pi-print-gateway` was removed with user approval and an off-device backup. Preserve current CUPS queues/drivers; they are not part of an application update.

The installation currently uses Debian 12 ARM64/Python 3.11 with a system-site-packages venv for the distro's pycups binding. Read-only CUPS listing/discovery works under the non-root service account. Printer creation, physical printing, hold/release/cancel and Canon-specific driver support remain separate acceptance gates.

The staged listener was deliberately configured to `192.168.88.228:8081` on a trusted LAN, with HTTP approved by the user. The repository's service template stays loopback by default. Machine-specific listener settings are deployment configuration, not a reason to change tracked source. A changed DHCP address requires updating the deployed listener; prefer a router reservation. HTTP does not encrypt passwords/API keys and must not be forwarded to the Internet.

## Release checklist

1. Verify clean working state, run Python tests/lint, JavaScript syntax and the offline browser regression from README. Build wheel/sdist. Browser fixtures contain fake Canon/other model names and do not prove installed hardware drivers.
2. Commit and push. Record the full `git rev-parse HEAD`; produce checksums for the wheel and every tracked file under `src/print_appliance`.
3. Check target disk, active app jobs and CUPS config fingerprints. If active jobs exist, arrange a maintenance window instead of stopping the coordinator blindly. Protect any backup containing configuration credentials with directory 0700/file 0600 outside Git.
4. Clone the public repository into `/opt/print-appliance/source` if absent. For an existing checkout, require a clean tree, fetch and detach-checkout the recorded commit. Use no GitHub account token; public HTTPS is sufficient.
5. Verify target checkout HEAD equals the Mac commit. Transfer the matching complete wheel, verify its checksum, and preserve the previous wheel. Python-only code remains wheel-packaged; static assets are included automatically.
6. Stop only `print-appliance`, install the new wheel with the existing venv using `pip install --no-deps --force-reinstall WHEEL`, restore root-owned/service-readable package permissions and start only that service. Reuse existing dependencies when the lockfile has not changed; otherwise install the hash-pinned runtime export deliberately before activating the release.
7. Compare installed source/package file hashes to the recorded commit. Write `SOURCE_COMMIT` only after successful activation and checks. Confirm HTTP/admin/read-only discovery, no unintended printer/job changes, CUPS config fingerprints unchanged.
8. If activation fails, reinstall the preserved previous wheel and restore the recorded previous checkout/release identifier. Report the failed release and any temporary Mac/device mismatch; never claim the new commit is deployed after rollback.

## Frontend update 0.1.1

- Five function tabs, keyboard navigation and hash-preserved view.
- Typed driver search in create and managed edit forms, matching model/PPD ID without case or accent sensitivity.
- At most 200 visible results for large catalogues; a previously selected matching driver remains visible even outside the first 200.
- No matches clears the selection; required selection prevents accidentally creating/remapping a queue with a different default driver. Enter in the search field does not create/save a printer.
- No new runtime dependencies, CUPS configuration changes or physical print test.

## CRUD/UI update 0.1.2

Adds nullable `deleted_at` columns to printers and clients on startup. Deletion is soft: job/history foreign keys remain valid and a retired printer queue token frees the unique queue name for future registration. The deployed data directory must be backed up with the service stopped before migration. Keep the previous wheel and exact source commit.

**Rollback after accepting CRUD changes requires care:** version 0.1.1 does not filter soft-deleted rows. Do not simply reinstall the old wheel against a database changed by 0.1.2. Stop the service, preserve a new backup, reconcile any newly accepted jobs, then restore the pre-upgrade data backup only when no new production jobs would be lost. Never silently restore an older print database after a possible handoff.

Target smoke must distinguish real admin/API/read-only CUPS checks from mocked browser tests. Use temporary client records for CRUD, and test printer registration only against an explicitly designated test queue without print submissions or physical printer changes. Do not unregister the user's real printer to exercise deletion.
