"""Persistent work-based admission: useful progress, not a fixed deck call count."""
import json
import sqlite3
import time
from pathlib import Path
from call_budget import BudgetExhausted
from ppt_contract import PAGE_REPAIR_LIMIT


class WorkStopped(BudgetExhausted):
    pass


class ValidationBudgetModel:
    """One page's patch and rerender attempts share a persistent progress ledger."""
    progress_controlled = True

    def __init__(self, project, scope, model, approval_id=None):
        self.budget = WorkBudget(project, scope, 'render_repair')
        self.model, self.pending = model, None
        self.approval_id = approval_id

    def __call__(self, prompt, **kwargs):
        self.last_submission_count = 0
        if self.pending is not None:
            self.feedback(None, 'previous outcome unknown')
        from request_journal import admit
        self.pending = admit(self.budget, 'page', prompt, request_kwargs=kwargs,
                             approval_id=self.approval_id, automatic_limit=PAGE_REPAIR_LIMIT)
        try:
            from request_journal import invoke
            return invoke(self.budget,self.pending,prompt,self.model,
                          context=getattr(self,'request_context',{}),**kwargs)
        except Exception as exc:
            with self.budget.connect() as db:
                db.execute("UPDATE attempts SET status='outcome_unknown',detail=? WHERE id=? AND status='in_flight'",
                           (type(exc).__name__,self.pending))
            self.last_submission_count=self.budget.submission_count(self.pending)
            self.pending=None
            raise
        finally:
            if self.pending is not None:
                self.last_submission_count=self.budget.submission_count(self.pending)

    def feedback(self, remaining, detail=''):
        if self.pending is not None:
            self.budget.finish(self.pending, remaining=remaining, detail=detail)
            self.pending = None


def feedback(model, remaining, detail=''):
    if isinstance(model, ValidationBudgetModel):
        model.feedback(remaining, detail)


class WorkBudget:
    def __init__(self, project, scope, stage, *, call_limit=None):
        self.path = Path(project) / 'reports/execution_budget.sqlite'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.scope, self.stage = scope, stage
        # Invocation-local aliases only: a late external result cannot use these
        # to finish a different request. Persistent lineage is diagnostic evidence.
        self.result_tokens = {}
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS attempts (
                    id INTEGER PRIMARY KEY, scope TEXT, stage TEXT, unit TEXT,
                    started REAL, status TEXT, remaining INTEGER, detail TEXT);
                CREATE TABLE IF NOT EXISTS grants (
                    id TEXT PRIMARY KEY, scope TEXT, stage TEXT, units TEXT, allowance INTEGER, used INTEGER);
                CREATE TABLE IF NOT EXISTS policy (id INTEGER PRIMARY KEY CHECK(id=1), call_limit INTEGER);
                CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS transport_replacements (
                    old_id INTEGER PRIMARY KEY, new_id INTEGER UNIQUE);
            ''')
            db.execute('BEGIN IMMEDIATE')
            if not db.execute("SELECT 1 FROM migrations WHERE name='legacy-v1'").fetchone():
                reports = self.path.parent
                for filename, table, stage in [('workflow_calls.sqlite', 'requests', 'legacy_workflow'),
                                                ('call_budget.sqlite', 'calls', 'legacy_build')]:
                    legacy = reports / filename
                    if not legacy.exists():
                        continue
                    with sqlite3.connect(legacy.resolve().as_uri() + '?mode=ro', uri=True) as source:
                        tables = {r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                        if table in tables:
                            count = source.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                            db.executemany('INSERT INTO attempts(scope,stage,unit,started,status,detail) VALUES (?,?,?,?,?,?)',
                                [('legacy', stage, str(n), 0, 'historical', filename) for n in range(count)])
                        if filename == 'call_budget.sqlite' and 'policy' in tables:
                            cap = source.execute('SELECT hard FROM policy WHERE id=1').fetchone()
                            if cap:
                                db.execute('INSERT OR IGNORE INTO policy VALUES (1,?)', cap)
                db.execute("INSERT INTO migrations VALUES ('legacy-v1')")
            if call_limit is not None:
                if call_limit < 1:
                    raise ValueError('call limit must be positive')
                db.execute('INSERT OR REPLACE INTO policy VALUES (1,?)', (call_limit,))

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def grant(self, units, calls, grant_id):
        if not units or calls < 1 or not grant_id:
            raise ValueError('grant requires target units, positive calls and an approval identity')
        payload = json.dumps(sorted(set(units)))
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT scope,stage,units,allowance FROM grants WHERE id=?', (grant_id,)).fetchone()
            expected = (self.scope, self.stage, payload, calls)
            if old and old != expected:
                raise ValueError('grant identity already belongs to different authorization')
            db.execute('INSERT OR IGNORE INTO grants VALUES (?,?,?,?,?,0)', (grant_id, *expected))

    def reserve(self, unit, *, approval_id=None, automatic_limit=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            cap = db.execute('SELECT call_limit FROM policy WHERE id=1').fetchone()
            used = db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0]
            if cap and used >= cap[0]:
                raise WorkStopped(f'project_resource_limit: {used}/{cap[0]} text attempts')
            pending = db.execute("SELECT id,status FROM attempts WHERE scope=? AND stage=? AND unit=? AND status IN ('in_flight','outcome_unknown') ORDER BY id DESC",
                                 (self.scope,self.stage,unit)).fetchall()
            if any(status == 'in_flight' for _,status in pending):
                raise WorkStopped('outcome_unknown: local request still in flight')
            if pending:
                return self._replace_unknown(db, pending[0][0])
            if not approval_id and db.execute("SELECT 1 FROM attempts WHERE scope=? AND stage=? AND unit=? AND status='transport_exhausted'",
                                             (self.scope,self.stage,unit)).fetchone():
                raise WorkStopped('transport_retry_exhausted: continue other work; retain best available page')
            history = db.execute("SELECT status,remaining FROM attempts WHERE scope=? AND stage=? AND unit=? AND status NOT IN ('superseded_unknown','abandoned_unknown','not_submitted') ORDER BY id",
                                 (self.scope, self.stage, unit)).fetchall()
            best, stalled = None, 0
            for status, remaining in history:
                if remaining is not None and (best is None or remaining < best):
                    best, stalled = remaining, 0
                else:
                    stalled += 1
            if history and history[-1] == ('completed', 0):
                raise WorkStopped('work_already_complete: reuse the accepted result')
            # Once a unit enters scoped authorization, a later ordinary resume
            # must spend that same allowance, never regain automatic attempts
            # merely because the last authorized patch reduced the error count.
            if not approval_id:
                grants = db.execute('SELECT id,units,used,allowance FROM grants WHERE scope=? AND stage=? ORDER BY rowid',
                                    (self.scope, self.stage)).fetchall()
                matching = [(gid,used,allowance) for gid,units,used,allowance in grants if unit in json.loads(units)]
                if matching:
                    approval_id = next((gid for gid,used,allowance in matching if used < allowance), None)
                    if approval_id is None:
                        raise WorkStopped('scoped_approval_exhausted: request new explicit authorization')
            if not approval_id and automatic_limit is not None and len(history) >= automatic_limit:
                raise WorkStopped(f'page_repair_limit: {len(history)}/{automatic_limit}; deliver best available page')
            if approval_id:
                row = db.execute('SELECT units,used,allowance FROM grants WHERE id=? AND scope=? AND stage=?',
                                 (approval_id, self.scope, self.stage)).fetchone()
                if not row or unit not in json.loads(row[0]) or row[1] >= row[2]:
                    raise WorkStopped('scoped_approval_exhausted: request new explicit authorization')
                db.execute('UPDATE grants SET used=used+1 WHERE id=?', (approval_id,))
            elif stalled >= 2:
                raise WorkStopped(f'no_progress: {unit}; two consecutive non-improving attempts; use a scoped approval')
            return db.execute('INSERT INTO attempts(scope,stage,unit,started,status) VALUES (?,?,?,?,?)',
                              (self.scope, self.stage, unit, time.time(), 'in_flight')).lastrowid

    def _replace_unknown(self, db, token):
        row=db.execute('SELECT scope,stage,unit,status FROM attempts WHERE id=?',(token,)).fetchone()
        if not row or row[:2] != (self.scope,self.stage) or row[3] != 'outcome_unknown':
            raise WorkStopped('stale transport replacement')
        receipt=self.path.parent/'request_journal'/f'{token}.json'
        if receipt.exists():
            record=json.loads(receipt.read_text(encoding='utf-8'))
            if record.get('response') is not None or record.get('status') == 'response_saved':
                raise WorkStopped('request_response_available: reconcile saved bytes; corrupt evidence is not a transport retry')
        count=db.execute('SELECT COUNT(*) FROM transport_replacements r JOIN attempts a ON a.id=r.old_id WHERE a.scope=? AND a.stage=? AND a.unit=?',row[:3]).fetchone()[0]
        if count >= 2:
            # Caller must commit the terminal state before raising.
            db.execute("UPDATE attempts SET status='transport_exhausted' WHERE id=?",(token,))
            db.commit()
            raise WorkStopped('transport_retry_exhausted: continue other work; retain best available page')
        cap=db.execute('SELECT call_limit FROM policy WHERE id=1').fetchone()
        if cap and db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0] >= cap[0]:
            raise WorkStopped('project_resource_limit: transport replacement respects cumulative cap')
        new=db.execute('INSERT INTO attempts(scope,stage,unit,started,status,detail) VALUES (?,?,?,?,?,?)',
                       (*row[:3],time.time(),'in_flight',f'transport replacement of {token}; cost of old request unknown')).lastrowid
        db.execute('INSERT INTO transport_replacements VALUES (?,?)',(token,new))
        db.execute("UPDATE attempts SET status='superseded_unknown' WHERE id=?",(token,))
        return new

    def replace_unknown(self, token):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            return self._replace_unknown(db, token)

    def effective_token(self, token):
        return self.result_tokens.get(token, token)

    def latest_token(self, token):
        """Read-only persisted lineage for crash recovery, not commit authority."""
        with self.connect() as db:
            seen=set()
            while token not in seen:
                seen.add(token)
                row=db.execute('SELECT new_id FROM transport_replacements WHERE old_id=?',(token,)).fetchone()
                if not row: return token
                token=row[0]
        raise ValueError('cyclic transport receipt lineage')

    def submission_count(self, token):
        """Count journaled adapter entries in this invocation's retry chain."""
        total=0
        with self.connect() as db:
            seen=set()
            while token not in seen:
                seen.add(token)
                path=self.path.parent/'request_journal'/f'{token}.json'
                if path.exists() and json.loads(path.read_text(encoding='utf-8')).get('status') != 'not_submitted': total+=1
                row=db.execute('SELECT new_id FROM transport_replacements WHERE old_id=?',(token,)).fetchone()
                if not row: return total
                token=row[0]
        raise ValueError('cyclic transport receipt lineage')

    def finish(self, token, *, remaining=None, detail=''):
        token = self.effective_token(token)
        if remaining is not None and remaining < 0:
            raise ValueError('negative remaining work')
        with self.connect() as db:
            changed = db.execute('UPDATE attempts SET status=?,remaining=?,detail=? WHERE id=? AND scope=? AND stage=? AND status=?',
                ('completed', remaining, detail, token, self.scope, self.stage, 'in_flight')).rowcount
            if changed != 1:
                raise ValueError('attempt is stale, unknown or already completed')
        path = self.path.parent/'request_journal'/f'{token}.json'
        if path.exists():
            from stage_runtime import atomic_write_json
            record = json.loads(path.read_text(encoding='utf-8'))
            if record.get('status') == 'response_saved':
                atomic_write_json(path, dict(record, consumed=True))


def summary(project):
    path = Path(project) / 'reports/execution_budget.sqlite'
    if not path.is_file():
        return {'attempts': 0, 'policy': 'work_based', 'call_limit': None}
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        cap = db.execute('SELECT call_limit FROM policy WHERE id=1').fetchone()
        has_replacements=db.execute("SELECT 1 FROM sqlite_master WHERE name='transport_replacements'").fetchone()
        return {'attempts': db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0],
                'call_limit': cap[0] if cap else None, 'policy': 'work_based',
                'by_stage': dict(db.execute('SELECT stage,COUNT(*) FROM attempts GROUP BY stage')),
                'in_flight': db.execute("SELECT COUNT(*) FROM attempts WHERE status='in_flight'").fetchone()[0],
                'unknown_outcomes': db.execute("SELECT COUNT(*) FROM attempts WHERE status='outcome_unknown'").fetchone()[0],
                'transport_replacements': db.execute('SELECT COUNT(*) FROM transport_replacements').fetchone()[0] if has_replacements else 0,
                'unknown_cost_attempts': db.execute("SELECT COUNT(*) FROM attempts WHERE status IN ('outcome_unknown','superseded_unknown','transport_exhausted','abandoned_unknown')").fetchone()[0],
                'grants': [dict(id=r[0], stage=r[1], units=json.loads(r[2]), allowance=r[3], used=r[4])
                           for r in db.execute('SELECT id,stage,units,allowance,used FROM grants')]}
