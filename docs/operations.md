# Operations and rollout

## Current system (confirmed from user screenshots)

EDATEC is reachable by SSH as `pi` at the address then shown as `192.168.1.218`; this is not a hardcoded product configuration. Service `pi-print-gateway` is enabled/running under `/opt/pi-print-gateway`. CUPS has a default queue `BROTHER_MFC` targeting `ipp://192.168.0.239:631/ipp/print`. Connectivity of that old printer has not been verified. The new Canon model/connection is not yet known.

Do not reset the appliance, change the old gateway, or remove the Brother queue as a shortcut. On macOS switch Vietnamese input to ABC/U.S. when typing SSH passwords; do not post credentials in chat/logs.

## Before deployment

Read-only inventory: OS/Python, disk free, CUPS version/device discovery/drivers, service/queue configuration. Check Canon model and supported driver on ARM; do not assume generic Canon support. Save a backup of existing service/config/CUPS before any approved changes. Use a new service and port for staging.

## Development vs real printing

Tests must inject an explicit fake adapter; fake success is never proof of physical printing. Production must use a real local CUPS connection and report missing CUPS/driver clearly. System Python on Linux can access distro-provided python3-cups; installer/venv must account for this rather than silently falling back to fake printing.

## Safe rollout

1. Test package locally without connecting to printers.
2. Install a separate `print-appliance` service on an unused port (8081 suggested), with its own data and least-privilege service user. Keep old gateway intact.
3. Bootstrap an admin password locally; create a scoped client key. Do not use default credentials.
4. Register a test printer/queue deliberately. Avoid enabling two senders on the same physical printer during acceptance testing.
5. Run print/queue/restart/failure acceptance checks. Only migrate Odoo URL/key after validation and explicit permission.
6. Rollback: stop/disable new service and revert client URL/key to saved values; do not uninstall CUPS or delete old queues.

## Pause and uncertain outcomes

Offline conditions latch a pause and require an operator to resume. CUPS has its own retry/queue behavior; verify that actual CUPS queues follow application pause policy. Stopping after an error cannot prevent pages already emitted. When outcome is unknown, inspect CUPS job history/printer/operator evidence and record a resolution; never blindly submit the same content again.

## Retention and backups

Completed/failed/canceled terminal files are removed; waiting/held/unknown payloads are retained. History default: 30 days. Minimal idempotency records remain after history cleanup. Backup the database/config while consistent; for live SQLite use its backup interface, not just copy the main file while WAL is active. Keep spool files and their metadata consistent. Monitor disk free and reject new work before losing accepted jobs.

## Verification status

See README for actual local run/test/install commands, CLI and implemented routes. The checked-in service unit is `deploy/print-appliance.service`; it binds to loopback:8081, runs as non-root `print-appliance`, and grants `lpadmin` as a supplementary group. `cups.service` is ordered before the app but is not a hard systemd dependency, so the UI can report unavailable CUPS rather than simulate success. Match the distro pycups binding to the Python ABI used for the venv.

PyCUPS handoff uses `printFile` with `job-hold-until=indefinite` and a correlation job name, persists the returned ID before release through `setJobHoldUntil(job_id, 'no-hold')`, reconciles using `getJobs(which_jobs='all', my_jobs=False, requested_attributes=[...])` / `getJobAttributes`, and verifies cancel through state polling. `cancelJob` returning `None` is not evidence of cancellation. Managed queues request `stop-printer` error policy. Confirm the local UNIX socket authorization permits discovery, queue administration, enable/disable, job hold/release and cancel with the service account; a TCP localhost connection or lpadmin membership alone is not an assumption of passwordless `@SYSTEM/operator` access.

Tests use only explicitly injected fake CUPS; no Linux/EDATEC/Canon physical test, local CUPS authorization test, ARM driver test, or printer output test has been performed. The implementation fails safe for unreconciled submissions by retaining an `unknown` outcome and never automatically resending. Do not mark the appliance production-ready until the hardware acceptance gate is satisfied.

## Implemented runtime details

The local socket defaults to `/run/cups/cups.sock`; use `PRINT_APPLIANCE_CUPS_SOCKET` if the target distro uses another Unix path. No TCP CUPS admin assumption. The new loopback service must be deliberately exposed to LAN via reviewed reverse proxy/TLS or a specific LAN listener/firewall; Internet exposure remains out of scope.

An imported old queue is initially paused in the application without modifying CUPS at registration. Resume is blocked unless error policy is `stop-printer`. If the queue is dedicated and changing it is approved, a technician can set `lpadmin -p QUEUE -o printer-error-policy=stop-printer`, then verify. Do not run this on `BROTHER_MFC` or another existing sender's queue merely to make staging pass. Prefer a new managed test queue.

Snapshot mismatch is not auto-migration: restore the original queue mapping or cancel affected queued jobs and ask the client for a new explicitly intended request. For a CUPS `stopped` job, possible partial paper output makes the result unknown; cancel/verify before recording evidence. No restarting/reprocessing of stopped jobs. Raw ZPL may have device-specific copy/label settings (`^PQ` etc.); test physical counts on the actual Zebra-compatible model.

Modern Python and pycups must match the target ABI. If the existing Raspberry Pi OS only provides Python 3.9, do not silently upgrade the appliance OS: inventory first and plan a separate runtime/driver installation. Existing hardware/gateway remains untouched by this implementation.
