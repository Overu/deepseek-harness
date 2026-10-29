"""Generated-image demand and byte receipts shared by every consumer."""
import json
from stage_runtime import sha256_text, sha256_file, atomic_write_json
from sol_common import resolve_asset_target


def image_prompt(spec, blueprint):
    language=(blueprint.get('theme') or {}).get('image_language') or 'cohesive editorial photography'
    return f"{spec.get('desc','')} {spec.get('requirement','')}. {language}. no text, no letters, no logo, no watermark".strip()


def demand_hash(spec, blueprint):
    return sha256_text(json.dumps({'prompt':image_prompt(spec,blueprint),
        'aspect':spec.get('aspect','16:9')},sort_keys=True,ensure_ascii=False))


def lineage_findings(project, blueprint, pages=None, *, file_hash=None, asset_cache=None):
    """A filename or a ready marker is not evidence of generation ownership."""
    cache_path=project/'reports/image-cache.json'
    file_hash = file_hash or sha256_file
    cache = asset_cache
    if cache is None:
        try:
            cache=json.loads(cache_path.read_text(encoding='utf-8')).get('assets',{}) if cache_path.exists() else {}
        except (OSError,ValueError,AttributeError):
            cache={}
    findings=[]
    for page in pages if pages is not None else blueprint.get('pages',[]):
        for spec in page.get('images',[]):
            if spec.get('asset_id'):
                continue  # Reused originals/derivatives use asset_preflight lineage.
            src=spec.get('src','')
            try:
                target=resolve_asset_target(project/'assets',src)
                row=cache.get(src,{})
                if not target.is_file():
                    raise ValueError('generated asset is missing')
                if row.get('demand_sha256') != demand_hash(spec,blueprint):
                    raise ValueError('generated asset has no matching demand receipt; preserve file, run image stage or register an authorized source asset')
                if row.get('output_sha256') != file_hash(target):
                    raise ValueError('generated asset bytes differ from its receipt')
            except (OSError,ValueError,AttributeError) as exc:
                findings.append({'code':'asset_consumer_error','page_no':page['no'],'page':page['no'],
                    'src':src,'message':str(exc),'source':'generated_image_lineage'})
    return findings


def unresolved_images(project):
    rows=[]
    for path in sorted((project/'reports/image_transactions').glob('*.json')):
        record=json.loads(path.read_text(encoding='utf-8'))
        if record.get('status') in {'submitted','outcome_unknown','response_saved'}:
            rows.append({key:record.get(key) for key in
                         ('src','request_id','status','contract_sha256','reason')})
    return rows


def acknowledge_image_unknown(project, src, request_id, approval_id):
    """Caller holds project lock and checks the local owner; never claim remote cancellation."""
    resolve_asset_target(project/'assets',src)
    if not approval_id or not request_id:
        raise ValueError('explicit approval and exact image request ID required')
    path=project/'reports/image_transactions'/(sha256_text(src)+'.json')
    record=json.loads(path.read_text(encoding='utf-8'))
    if record.get('src')!=src or record.get('request_id')!=request_id:
        raise ValueError('image request identity changed; inspect reconciliation report')
    if record.get('status')=='abandoned_unknown' and record.get('approval_id')==approval_id:
        return record
    if record.get('status') not in {'submitted','outcome_unknown'}:
        raise ValueError('only unresolved image requests may be acknowledged; recover saved output first')
    record=dict(record,status='abandoned_unknown',approval_id=approval_id,
                risk='provider may have billed original request; no refund/cancellation inferred')
    atomic_write_json(path.parent/'archive'/(sha256_text(request_id)+'.json'),record)
    atomic_write_json(path,record)
    return record
