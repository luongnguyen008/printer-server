from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Protocol


class BackendUnavailable(RuntimeError):
    """The local CUPS service or its Python binding cannot be reached."""


class CupsBackend(Protocol):
    def health(self) -> dict[str, Any]: ...
    def discover(self) -> dict[str, list[dict[str, str]]]: ...
    def queues(self) -> dict[str, dict[str, Any]]: ...
    def queue_mapping(self, queue: str) -> dict[str, str] | None: ...
    def printer_status(self, queue: str) -> dict[str, Any]: ...
    def create_queue(self, queue: str, device_uri: str, driver: str) -> None: ...
    def update_queue(self, queue: str, device_uri: str, driver: str) -> None: ...
    def pause_printer(self, queue: str) -> None: ...
    def resume_printer(self, queue: str) -> None: ...
    def submit_held(
        self, queue: str, filename: str, title: str, options: dict[str, str], correlation: str
    ) -> int: ...
    def find_job(self, correlation: str) -> dict[str, Any] | None: ...
    def get_job(self, job_id: int) -> dict[str, Any] | None: ...
    def release_job(self, job_id: int) -> None: ...
    def cancel_job(self, job_id: int) -> None: ...


class PyCupsBackend:
    """Thin, lazy adapter around pycups; connection defaults to local CUPS/UNIX socket."""

    def _connection(self) -> Any:
        try:
            import cups  # type: ignore[import-not-found]

            socket_path = os.environ.get("PRINT_APPLIANCE_CUPS_SOCKET", "/run/cups/cups.sock")
            if not socket_path.startswith("/"):
                raise ValueError("CUPS must use a local Unix socket")
            return cups.Connection(host=socket_path)
        except Exception as exc:
            raise BackendUnavailable("Local CUPS is unavailable or not authorized") from exc

    def health(self) -> dict[str, Any]:
        connection = self._connection()
        try:
            queues = connection.getPrinters()
            return {"available": True, "queue_count": len(queues), "message": "CUPS connected"}
        except Exception as exc:
            raise BackendUnavailable("Unable to query local CUPS") from exc

    def discover(self) -> dict[str, list[dict[str, str]]]:
        connection = self._connection()
        try:
            devices = connection.getDevices(
                include_schemes=["usb", "ipp", "ipps", "socket", "lpd", "dnssd"]
            )
            ppds = connection.getPPDs()
            return {
                "devices": [
                    {
                        "uri": str(uri),
                        "info": str(item.get("device-info", "")),
                        "make_model": str(item.get("device-make-and-model", "")),
                    }
                    for uri, item in sorted(devices.items())
                ],
                "drivers": [
                    {"id": str(name), "make_model": str(item.get("ppd-make-and-model", name))}
                    for name, item in sorted(ppds.items())
                ],
            }
        except Exception as exc:
            raise BackendUnavailable("Unable to discover CUPS devices and drivers") from exc

    def queues(self) -> dict[str, dict[str, Any]]:
        try:
            return {
                str(name): dict(attrs) for name, attrs in self._connection().getPrinters().items()
            }
        except Exception as exc:
            raise BackendUnavailable("Unable to list CUPS queues") from exc

    def queue_mapping(self, queue: str) -> dict[str, str] | None:
        connection = self._connection()
        try:
            attrs = connection.getPrinters().get(queue)
            if attrs is None:
                return None
            device_uri = str(attrs.get("device-uri", ""))
            policy_attrs = connection.getPrinterAttributes(
                queue, requested_attributes=["printer-error-policy"]
            )
            error_policy = str(policy_attrs.get("printer-error-policy", "unknown"))
            driver_source: dict[str, Any] = {
                "ppd_name": attrs.get("printer-ppd-name"),
                "driver_name": attrs.get("printer-driver-name"),
                "make_model": attrs.get("printer-make-and-model"),
                "printer_type": attrs.get("printer-type"),
            }
            try:
                ppd_path = connection.getPPD(queue)
                if ppd_path:
                    path = Path(str(ppd_path))
                    driver_source = {"ppd_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    path.unlink(missing_ok=True)
            except Exception as exc:
                # Raw queues deliberately have no PPD. Other queues must provide a fingerprint;
                # model names alone cannot distinguish two drivers with the same display name.
                if "raw" not in str(attrs.get("printer-make-and-model", "")).lower():
                    raise BackendUnavailable(
                        "Cannot verify this queue's driver fingerprint"
                    ) from exc
            signature = hashlib.sha256(
                json.dumps(
                    driver_source, sort_keys=True, default=str, separators=(",", ":")
                ).encode()
            ).hexdigest()
            return {
                "device_uri": device_uri,
                "mapping_signature": signature,
                "error_policy": error_policy,
            }
        except Exception as exc:
            raise BackendUnavailable("Unable to inspect CUPS queue mapping") from exc

    def printer_status(self, queue: str) -> dict[str, Any]:
        try:
            attrs = self._connection().getPrinters().get(queue)
            if attrs is None:
                return {"known": False, "online": False, "message": "CUPS queue missing"}
            state = int(attrs.get("printer-state", 0))
            reasons = attrs.get("printer-state-reasons", [])
            reasons = [str(item) for item in reasons] if isinstance(reasons, (tuple, list)) else []
            offline = state == 5 or any(
                word in reason.lower()
                for reason in reasons
                for word in ("offline", "media-empty", "door-open", "paused", "error")
            )
            return {
                "known": True,
                "online": not offline,
                "state": state,
                "reasons": reasons,
                "message": str(attrs.get("printer-state-message", "")),
            }
        except Exception as exc:
            raise BackendUnavailable("Unable to query CUPS printer state") from exc

    def create_queue(self, queue: str, device_uri: str, driver: str) -> None:
        connection = self._connection()
        try:
            if queue in connection.getPrinters():
                raise ValueError("CUPS queue already exists")
            connection.addPrinter(queue, device=device_uri, ppdname=driver)
            connection.setPrinterErrorPolicy(queue, "stop-printer")
            connection.acceptJobs(queue)
            connection.enablePrinter(queue)
        except ValueError:
            raise
        except Exception as exc:
            raise BackendUnavailable("Unable to create the managed CUPS queue") from exc

    def update_queue(self, queue: str, device_uri: str, driver: str) -> None:
        connection = self._connection()
        try:
            if queue not in connection.getPrinters():
                raise ValueError("Managed CUPS queue no longer exists")
            connection.addPrinter(queue, device=device_uri, ppdname=driver)
            connection.setPrinterErrorPolicy(queue, "stop-printer")
        except ValueError:
            raise
        except Exception as exc:
            raise BackendUnavailable("Unable to update the managed CUPS queue") from exc

    def pause_printer(self, queue: str) -> None:
        try:
            self._connection().disablePrinter(queue)
        except Exception as exc:
            raise BackendUnavailable("Unable to pause the CUPS queue") from exc

    def resume_printer(self, queue: str) -> None:
        try:
            self._connection().enablePrinter(queue)
        except Exception as exc:
            raise BackendUnavailable("Unable to resume the CUPS queue") from exc

    def submit_held(
        self, queue: str, filename: str, title: str, options: dict[str, str], correlation: str
    ) -> int:
        try:
            safe_options = {str(key): str(value) for key, value in options.items()}
            safe_options.update({"job-hold-until": "indefinite", "job-name": correlation})
            return int(self._connection().printFile(queue, filename, correlation, safe_options))
        except Exception as exc:
            raise BackendUnavailable("CUPS submission outcome requires reconciliation") from exc

    def find_job(self, correlation: str) -> dict[str, Any] | None:
        try:
            jobs = self._connection().getJobs(
                which_jobs="all",
                my_jobs=False,
                requested_attributes=["job-id", "job-name", "job-state", "job-state-reasons"],
            )
            matches = [
                (job_id, attrs)
                for job_id, attrs in jobs.items()
                if attrs.get("job-name") == correlation
            ]
            if len(matches) > 1:
                raise BackendUnavailable("Multiple CUPS jobs match the handoff correlation")
            if matches:
                job_id, attrs = matches[0]
                return self._job_result(int(job_id), attrs)
            return None
        except Exception as exc:
            raise BackendUnavailable("Unable to reconcile CUPS job correlation") from exc

    def get_job(self, job_id: int) -> dict[str, Any] | None:
        try:
            attrs = self._connection().getJobAttributes(job_id)
            return self._job_result(job_id, attrs)
        except Exception as exc:
            # CUPS may have purged history; absence is not proof that submission never happened.
            if (
                exc.__class__.__name__ == "IPPError"
                and exc.args
                and exc.args[0] in {0x0406, 0x0407}
            ):
                return None
            raise BackendUnavailable("Unable to query CUPS job state") from exc

    @staticmethod
    def _job_result(job_id: int, attrs: dict[str, Any]) -> dict[str, Any]:
        states = {
            3: "pending",
            4: "held",
            5: "processing",
            6: "stopped",
            7: "canceled",
            8: "aborted",
            9: "completed",
        }
        state_num = int(attrs.get("job-state", 0))
        return {
            "id": job_id,
            "correlation": str(attrs.get("job-name", "")),
            "state": states.get(state_num, "unknown"),
            "state_number": state_num,
            "reasons": attrs.get("job-state-reasons", []),
        }

    def release_job(self, job_id: int) -> None:
        try:
            self._connection().setJobHoldUntil(job_id, "no-hold")
        except Exception as exc:
            raise BackendUnavailable("Unable to release the held CUPS job") from exc

    def cancel_job(self, job_id: int) -> None:
        try:
            # cancelJob returns None; callers must query job state for evidence.
            self._connection().cancelJob(job_id, purge_job=False)
        except Exception as exc:
            raise BackendUnavailable("Unable to request CUPS job cancellation") from exc
