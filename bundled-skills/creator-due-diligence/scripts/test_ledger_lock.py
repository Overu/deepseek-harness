"""Offline native-process locking checks and Windows adapter regressions."""
import errno
import importlib.util
import json
import multiprocessing
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import tikhub_public as api


def _route():
    catalog = json.loads(api.CATALOG.read_text(encoding="utf-8"))
    route = next(r for r in catalog["endpoints"]
                 if r["path"] == "/api/v1/douyin/app/v3/fetch_video_comments")
    return dict(route, price_usd="0.60")


def _collect_worker(folder, name, entered, release, ready, results):
    original_read = api.read_ledger

    def read(stream):
        rows = original_read(stream)
        entered.set()
        if release is not None and not release.wait(10):
            raise RuntimeError("test did not release the ledger reader")
        return rows

    root = Path(folder)
    payload = {"code": 200, "data": {"comments": [{"cid": "1", "text": "公开评论"}]}}
    with patch.object(api, "read_ledger", side_effect=read), \
            patch.object(api, "request_json", return_value=(200, payload)) as request:
        ready.set()
        try:
            result = api.collect(_route(), {"aweme_id": "123"}, root / (name + ".json"),
                                 root / "台账.jsonl", budget="1")
            results.put(("collected", request.call_count, result["output_saved"]))
        except api.BudgetExceeded:
            results.put(("budget_exhausted", request.call_count, False))


def _hold_ledger(folder, ready):
    with (Path(folder) / "台账.jsonl").open("a+", encoding="utf-8") as stream, api.ledger_lock(stream):
        ready.set()
        time.sleep(15)


class LedgerLockTests(unittest.TestCase):
    def test_module_import_does_not_require_posix_fcntl(self):
        spec = importlib.util.spec_from_file_location("collector_without_fcntl", api.__file__)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"fcntl": None}):
            spec.loader.exec_module(module)
        self.assertTrue(callable(module.collect))

    def test_windows_contention_and_body_failure_unlock_the_same_byte_without_sentinels(self):
        calls = []
        conflicts = 12

        def locking(fd, mode, count):
            calls.append((mode, count, os.lseek(fd, 0, os.SEEK_CUR)))
            if mode == 2 and len(calls) <= conflicts:
                raise OSError(errno.EACCES, "locked by another collector")

        adapter = types.SimpleNamespace(LK_NBLCK=2, LK_UNLCK=0, locking=locking)
        with tempfile.TemporaryDirectory(prefix="达人背调-") as folder:
            ledger = Path(folder) / "台账.jsonl"
            with patch.object(api.sys, "platform", "win32"), \
                    patch.dict(sys.modules, {"msvcrt": adapter, "fcntl": None}), \
                    patch.object(api.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "body failed"):
                    with ledger.open("a+", encoding="utf-8") as stream, api.ledger_lock(stream):
                        self.assertEqual(ledger.read_bytes(), b"")
                        api.append_row(stream, {"kind": "diagnostic", "text": "中文记录"})
                        raise RuntimeError("body failed")
                self.assertTrue(stream.closed)
                self.assertEqual(sleep.call_count, conflicts)
            self.assertEqual(calls, [(2, 1, 0)] * (conflicts + 1) + [(0, 1, 0)])
            self.assertNotIn(b"\0", ledger.read_bytes())
            self.assertEqual(json.loads(ledger.read_text(encoding="utf-8"))["text"], "中文记录")

    def test_windows_lock_failure_stops_before_reservation_or_network(self):
        locking = Mock(side_effect=OSError(errno.EBADF, "invalid descriptor"))
        adapter = types.SimpleNamespace(LK_NBLCK=2, LK_UNLCK=0, locking=locking)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(api.sys, "platform", "win32"), \
                    patch.dict(sys.modules, {"msvcrt": adapter, "fcntl": None}), \
                    patch.object(api.time, "sleep") as sleep, \
                    patch.object(api, "request_json") as request:
                with self.assertRaises(OSError):
                    api.collect(_route(), {}, root / "result.json", root / "ledger.jsonl")
                request.assert_not_called()
                sleep.assert_not_called()
            self.assertEqual(locking.call_count, 1)
            self.assertEqual((root / "ledger.jsonl").read_bytes(), b"")
            self.assertFalse((root / "result.json").exists())

    def test_native_processes_serialize_budget_read_and_reservation(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="达人背调-") as folder:
            first_read, second_read = context.Event(), context.Event()
            first_ready, second_ready, release = context.Event(), context.Event(), context.Event()
            results = context.Queue()
            processes = [context.Process(target=_collect_worker,
                         args=(folder, "first", first_read, release, first_ready, results)),
                         context.Process(target=_collect_worker,
                         args=(folder, "second", second_read, None, second_ready, results))]
            try:
                processes[0].start()
                self.assertTrue(first_read.wait(10), "first collector did not acquire the lock")
                processes[1].start()
                self.assertTrue(second_ready.wait(10), "second collector did not start")
                self.assertFalse(second_read.wait(0.5), "second process read an uncommitted budget")
                release.set()
                for process in processes:
                    process.join(10)
                    self.assertEqual(process.exitcode, 0)
                self.assertEqual(sorted(results.get(timeout=2) for _ in processes),
                                 [("budget_exhausted", 0, False), ("collected", 1, True)])
                rows = [json.loads(line) for line in (Path(folder) / "台账.jsonl").read_text(encoding="utf-8").splitlines()]
                self.assertEqual(len([row for row in rows if row["kind"] == "reserve"]), 1)
            finally:
                release.set()
                for process in processes:
                    if process.pid is not None:
                        if process.is_alive():
                            process.terminate()
                        process.join(5)
                results.close()
                results.join_thread()

    def test_native_process_exit_releases_lock_for_the_next_collector(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory() as folder:
            held = context.Event()
            entered, ready, results = context.Event(), context.Event(), context.Queue()
            holder = context.Process(target=_hold_ledger, args=(folder, held))
            follower = context.Process(target=_collect_worker,
                                       args=(folder, "after-exit", entered, None, ready, results))
            try:
                holder.start()
                self.assertTrue(held.wait(10), "holder did not acquire the lock")
                holder.terminate()
                holder.join(5)
                self.assertFalse(holder.is_alive())
                follower.start()
                follower.join(10)
                self.assertEqual(follower.exitcode, 0, "terminated process left the ledger locked")
                self.assertEqual(results.get(timeout=2), ("collected", 1, True))
            finally:
                for process in (holder, follower):
                    if process.pid is not None:
                        if process.is_alive():
                            process.terminate()
                        process.join(5)
                results.close()
                results.join_thread()


if __name__ == "__main__":
    unittest.main()
