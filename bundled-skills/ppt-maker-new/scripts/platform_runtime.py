"""Host operations only: UTF-8 streams, local locks and owned-worker lifecycle."""
from __future__ import annotations
import os
from pathlib import Path
import signal
import subprocess
import sys

WINDOWS = sys.platform == 'win32'
ADAPTER_VERSION = 'host-runtime-v1'


def configure_console():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='backslashreplace')
            except (OSError, ValueError):
                pass  # Captured/closed host streams need not support reconfiguration.


def child_environment(**updates):
    return dict(os.environ, PYTHONUNBUFFERED='1', PYTHONUTF8='1',
                PYTHONIOENCODING='utf-8', **updates)


class _WindowsLock:
    def __init__(self, handle, locking, unlock):
        self.handle, self.locking, self.unlock = handle, locking, unlock

    def close(self):
        if self.handle.closed:
            return
        try:
            self.handle.seek(0)
            self.locking(self.handle.fileno(), self.unlock, 1)
        finally:
            self.handle.close()


def acquire_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open('a+b')
    try:
        if WINDOWS:
            import msvcrt
            if handle.seek(0, 2) == 0:
                handle.write(b'\0'); handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return _WindowsLock(handle, msvcrt.locking, msvcrt.LK_UNLCK)
        import fcntl
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except OSError as exc:
        handle.close()
        if isinstance(exc, BlockingIOError) or exc.errno in {11,13,35,36}:
            raise RuntimeError('project already has an active build; use status') from exc
        raise
    except Exception:
        handle.close()
        raise


def _psutil():
    try:
        import psutil
        return psutil
    except ImportError as exc:
        raise RuntimeError('Windows managed runtime requires psutil; install the packaged requirements with this Python') from exc


def process_alive(pid):
    """Tri-state query. Windows signal 0 is NOT a liveness probe."""
    if WINDOWS:
        ps = _psutil()
        try:
            return ps.Process(int(pid)).is_running()
        except ps.NoSuchProcess:
            return False
        except ps.AccessDenied:
            return None
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return None


def process_identity(pid):
    """No command lines/environment. Preserve legacy POSIX identity format."""
    if WINDOWS:
        ps = _psutil()
        try:
            return f'windows:{ps.Process(int(pid)).create_time():.6f}'
        except (ps.NoSuchProcess, ps.AccessDenied, ValueError):
            return None
    try:
        result = subprocess.run(['ps','-p',str(int(pid)),'-o','lstart='],
                                capture_output=True,text=True,encoding='utf-8',timeout=2)
        return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def spawn_options():
    return {'creationflags':0x00000200} if WINDOWS else {'start_new_session':True}


def bind_child(child):
    """Bind creation identity immediately; never reconstruct a kill target from a status PID."""
    if WINDOWS:
        ps = _psutil()
        try:
            child._ppt_owned_process = ps.Process(child.pid)
            child._ppt_owned_process.create_time()
        except ps.NoSuchProcess:
            child._ppt_owned_process = None


def stop_child(child, *, force=False):
    if child.poll() is not None:
        return
    if not WINDOWS:
        try:
            os.killpg(child.pid, signal.SIGKILL if force else signal.SIGTERM)
        except ProcessLookupError:
            pass
        return
    ps = _psutil()
    root = getattr(child, '_ppt_owned_process', None)
    if root is None or not root.is_running():
        raise RuntimeError('worker ownership could not be verified; no unrelated process was signalled')
    # Stop each parent from spawning before enumerating its direct children.
    # psutil protects suspend/terminate/kill against PID reuse. Do not use
    # taskkill /T on a bare PID, or terminate the DSH host's job/process group.
    pending, owned = [root], []
    try:
        while pending:
            process = pending.pop()
            try:
                process.suspend()
                owned.append(process)
                pending.extend(process.children())
            except ps.NoSuchProcess:
                continue
        for process in reversed(owned):
            try:
                process.kill() if force else process.terminate()
            except ps.NoSuchProcess:
                pass
    finally:
        # If permissions prevented cancellation, never leave a live worker frozen.
        for process in owned:
            try:
                if process.is_running(): process.resume()
            except (ps.NoSuchProcess, ps.AccessDenied):
                pass
