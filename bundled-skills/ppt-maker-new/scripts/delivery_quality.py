"""Current selection quality, not an inference from the runner's terminal label."""
import json
from quality_policy import partition


def quality_summary(rows, global_findings, qa):
    findings = list(global_findings)
    warnings = []
    for row in rows:
        findings += [dict(e, page=e.get('page', row['page_no'])) for e in row.get('errors', [])]
        warnings += [dict(e, page=e.get('page', row['page_no'])) for e in row.get('quality_warnings', [])]
    if qa:
        findings += qa.get('errors', [])
        warnings += qa.get('warnings', [])
    errors, advisory = partition(findings)
    warnings += advisory
    def unique(items):
        return list({json.dumps(e, sort_keys=True, ensure_ascii=False): e for e in items}.values())
    errors, warnings = unique(errors), unique(warnings)
    return {'available': True, 'blocking_count': len(errors), 'warning_count': len(warnings),
            'attention_pages': sorted({r['page_no'] for r in rows if r['status'] != 'validated'} |
                                      {e.get('page') or e.get('page_no') for e in errors if e.get('page') or e.get('page_no')}),
            'whole_deck_qa': ('passed' if qa['summary']['gate_passed'] else 'failed') if qa else 'not_rechecked',
            'qa_scope': 'selected_slide_content_assets_and_structure',
            'strict_pipeline_certified': False, 'visual_checked': False,
            'errors': errors, 'warnings': warnings}


def quality_sentence(quality):
    if quality['blocking_count']:
        return f"文件可打开，仍有 {quality['blocking_count']} 项阻断问题，见问题页清单；未进行视觉验收。"
    if quality['whole_deck_qa'] == 'passed':
        return '当前选页通过结构、内容契约与文件完整性检查；非阻断提醒不影响使用。未进行视觉验收。'
    return '当前页面无已知阻断问题；整稿检查尚未重新执行，不能据此认定质量失败或全部通过。未进行视觉验收。'
