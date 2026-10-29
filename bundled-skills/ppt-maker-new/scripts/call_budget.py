"""Atomic cross-process request budget, retained across DSH resumes."""
import os
import sqlite3
import time
from pathlib import Path


class BudgetExhausted(RuntimeError):
    """No network request was admitted; retrying XML cannot repair this state."""


def configure_budget(path, *, initial, hard_limit, scope):
    if initial < 1 or hard_limit < initial:
        raise ValueError('invalid budget limits')
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=30) as db:
        db.execute('CREATE TABLE IF NOT EXISTS policy (id INTEGER PRIMARY KEY CHECK(id=1), soft INTEGER, hard INTEGER, step INTEGER, scope TEXT, checkpoint INTEGER)')
        db.execute('CREATE TABLE IF NOT EXISTS progress (scope TEXT, page TEXT, PRIMARY KEY(scope,page))')
        db.execute('CREATE TABLE IF NOT EXISTS budget_events (started REAL, old_limit INTEGER, new_limit INTEGER, reason TEXT)')
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT soft, hard, scope FROM policy WHERE id=1').fetchone()
        if row is None:
            db.execute('INSERT INTO policy VALUES (1,?,?,?,?,0)', (initial, hard_limit, initial, scope))
        else:
            # Limits do not reset on resume. An explicit changed cap is recorded.
            db.execute('UPDATE policy SET hard=?, soft=MIN(soft,?), scope=? WHERE id=1', (hard_limit, hard_limit, scope))
            if row[1] != hard_limit:
                db.execute('INSERT INTO budget_events VALUES (?,?,?,?)', (time.time(), row[1], hard_limit, 'configured_hard_cap'))


def record_progress(page):
    path = os.environ.get('PPT_CALL_BUDGET_DB')
    if not path:
        return
    with sqlite3.connect(path, timeout=30) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='policy'").fetchone():
            return
        row = db.execute('SELECT scope FROM policy WHERE id=1').fetchone()
        if row:
            db.execute('INSERT OR IGNORE INTO progress VALUES (?,?)', (row[0], str(page)))


def bounded_recovery_model(project, scope, model, *, limit=4):
    path = Path(project) / 'reports/recovery_budget.sqlite'
    path.parent.mkdir(parents=True, exist_ok=True)
    def request(prompt, **kwargs):
        with sqlite3.connect(path, timeout=30) as db:
            db.execute('CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, scope TEXT, started REAL)')
            db.execute('BEGIN IMMEDIATE')
            count = db.execute('SELECT COUNT(*) FROM attempts WHERE scope=?', (scope,)).fetchone()[0]
            if count >= limit:
                raise BudgetExhausted(f'page_recovery_budget_exhausted: {count}/{limit}; needs targeted redesign')
            reservation = db.execute('INSERT INTO attempts(scope,started) VALUES (?,?)', (scope, time.time())).lastrowid
        try:
            return model(prompt, **kwargs)
        except BudgetExhausted:
            # The provider was never called; release only this recovery admission.
            with sqlite3.connect(path, timeout=30) as db:
                db.execute('DELETE FROM attempts WHERE id=?', (reservation,))
            raise
    return request


def reserve_call():
    path = os.environ.get('PPT_CALL_BUDGET_DB')
    if not path:
        return
    limit = int(os.environ['PPT_CALL_BUDGET_LIMIT'])
    with sqlite3.connect(path, timeout=30) as db:
        db.execute('CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, started REAL, run_id TEXT)')
        db.execute('BEGIN IMMEDIATE')
        used = db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='policy'").fetchone():
            policy = db.execute('SELECT soft,hard,step,scope,checkpoint FROM policy WHERE id=1').fetchone()
            if policy:
                soft, hard, step, scope, checkpoint = policy
                hard = min(hard, limit)
                progress = db.execute('SELECT COUNT(*) FROM progress WHERE scope=?', (scope,)).fetchone()[0]
                if used >= soft and soft < hard and progress > checkpoint:
                    new_limit = min(hard, max(soft + step, used + 1))
                    db.execute('UPDATE policy SET soft=?, checkpoint=? WHERE id=1', (new_limit, progress))
                    db.execute('INSERT INTO budget_events VALUES (?,?,?,?)', (time.time(), soft, new_limit, 'validated_page_progress'))
                    soft = new_limit
                limit = min(hard, soft)
        if used >= limit:
            raise BudgetExhausted(f'project_call_budget_exhausted: {used}/{limit}; inspect failures before increasing budget')
        db.execute('INSERT INTO calls(started, run_id) VALUES (?, ?)',
                   (time.time(), os.environ.get('PPT_BUILD_RUN_ID', '')))
