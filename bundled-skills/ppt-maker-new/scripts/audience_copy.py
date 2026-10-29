"""Shared, non-mutating checks for production notes leaking into visible copy.

This is a lexical safety net, not a semantic fact checker. Evidence limits and
ordinary recommendations are legitimate audience copy; never strip a qualifier
locally to make an unverified claim look confirmed.
"""
import copy
import html
import re
import unicodedata
from quality_policy import blocking, classify

# A new validation obligation is new repair work, not permission to reset totals.
COPY_POLICY_REVISION = 'audience-copy-v2'


def validation_scope(project, scope, stage, unit):
    """Reopen a previously complete unit, never reset a stalled/unknown unit."""
    from work_budget import WorkBudget
    budget = WorkBudget(project, scope, stage)
    revised = scope + ':' + COPY_POLICY_REVISION
    with budget.connect() as db:
        if db.execute('SELECT 1 FROM attempts WHERE scope=? AND stage=? AND unit=?',
                      (revised, stage, unit)).fetchone():
            return revised
        old = db.execute('SELECT status,remaining FROM attempts WHERE scope=? AND stage=? AND unit=? ORDER BY id DESC LIMIT 1',
                         (scope, stage, unit)).fetchone()
    return revised if old == ('completed', 0) else scope

LABELS = r'待核验|待核实|待验证|待补充|待完善|待填充|建议方法|内部备注|内部待办|制作备注|写作提示|TODO|TBD|TO\s+VERIFY|SUGGESTED\s+METHOD'
META_PATTERNS = [re.compile(p, re.I | re.M) for p in (
    r'^\s*(?:[-*•]\s*)?[\[【]\s*(?:' + LABELS + r')\s*[\]】]',
    r'^\s*(?:[-*•]\s*)?(?:' + LABELS + r')\s*[:：]',
    r'^\s*(?:[-*•]\s*)?(?:请|待|需)(?:补充|填入|核验|核实).{0,60}(?:本页|数据来源|原始来源|占位|引用出处)',
    r'^\s*(?:[-*•]\s*)?(?:此处|本页|这里)(?:需|请|待)?(?:插入|补充|填写|替换).+',
)]
SUSPECT_PATTERNS = [re.compile(p, re.I | re.M) for p in (
    r'preferred\s+concept', r'本页(?:结构|布局|说明)', r'设计注释',
    r'system\s+prompt', r'[\[【]\s*(?:' + LABELS + r')\s*[\]】]',
)]
INTERNAL_KEYS = frozenset({'internal_notes', 'design_note', 'design_notes',
                          'layout_notes', 'render_notes', 'production_notes', 'instructions'})


def normalized_for_check(text):
    value = unicodedata.normalize('NFKC', html.unescape(str(text)))
    return re.sub(r'[\u200b-\u200d\u2060\ufeff]', '', value)


def copy_findings(text, page=None, field=None, *, include_advisory=False):
    value = normalized_for_check(text)
    match = next((m for p in META_PATTERNS if (m := p.search(value))), None)
    code = 'meta_instruction_leak'
    if not match:
        match = next((m for p in SUSPECT_PATTERNS if (m := p.search(value))), None)
        code = 'possible_production_note'
    if not match or (code == 'possible_production_note' and not include_advisory):
        return []
    result = {'code': code, 'page': page,
              'message': f'production note in audience copy: {value[max(0, match.start()-15):match.end()+90]}; '
                         'SOL must route the todo to internal_notes/open_questions or author an audience-ready recommendation. '
                         'Do not merely remove the label, invent missing evidence, or erase necessary caveats.'}
    if field:
        result['field'] = field
    if code == 'possible_production_note':
        result['message'] = 'Contextual term may be normal subject matter; retain copy and assess in an already-needed model call: ' + value
    return [classify(result)]


def page_copy_findings(page):
    results = []
    def walk(value, path):
        if isinstance(value, str):
            results.extend(copy_findings(value, page.get('no'), path, include_advisory=True))
        elif isinstance(value, list):
            for i, v in enumerate(value):
                walk(v, f'{path}[{i}]')
        elif isinstance(value, dict):
            for k, v in value.items():
                if k not in INTERNAL_KEYS:
                    walk(v, f'{path}.{k}')
    for key in ('title', 'takeaway', 'content', 'subtitle', 'caption', 'footnotes', 'footer', 'header'):
        walk(page.get(key), key)
    # Nested table/chart/card text must not bypass the check. Descriptive image
    # requests and provenance IDs are not audience copy.
    for i, block in enumerate((page.get('layout') or {}).get('blocks', [])):
        walk(block.get('props', {}), f'layout.blocks[{i}].props')
    return results


def audience_page(page):
    def visible(value):
        if isinstance(value, dict):
            return {k:visible(v) for k,v in value.items() if k not in INTERNAL_KEYS}
        if isinstance(value, list):
            return [visible(v) for v in value]
        return copy.deepcopy(value)
    return visible(page)


def xml_copy_findings(root, page=None, *, include_advisory=False):
    # Join runs within a paragraph; preserve paragraph boundaries for anchored rules.
    text = '\n'.join(''.join(n.itertext()) for n in root.iter() if n.tag.split('}')[-1] == 'p')
    return copy_findings(text, page, 'rendered_text', include_advisory=include_advisory)


COPY_CONTRACT = '''
## 正文与内部工作记录分层（所有页面角色一致）
面向观众的业务正文：title/takeaway/content、表格、图表、图注只呈现具体业务事实、分析判断、策略、创意表达或执行安排。
用户提供的资料默认作为已确认的本次工作输入使用；不要自行重做真实性核验、追加补证任务或通用免责声明，也不要宣称已独立验证。
如果资料前后实质矛盾且最新用户要求不能确定取舍，在内部 conflicts/open_questions 记录具体冲突，由对话请用户确认；不要把矛盾改写成正文中的待核验任务，不得自行选数或编造结论。
用户原资料明确带有的预算假设、样本范围、合作状态等限定随对应业务内容保留；不擅自删掉，也不额外添加模型自己的质疑。
正文不是对提案或制作过程的说明：模型的思考、自我介绍、制作规范、质量保证、核验宣言、空泛自评及 TODO 均不进入任何可见文字；不得换一种说法保留它们。
反例（不能输出到页面）："这是一项重写冬季消费语境的增长提案"、"所有市场数字、竞品结论、预算及合作状态均保留来源与适用边界"。
正例（表达业务而非介绍提案）："把短暂阳光变成新的消费提示"；用户已给出的"预算为测算值，实际以供应商报价为准"属于必要限定，应保留。
规划时将无关制作记录放 exclude 或 internal_notes，不让其成为 must_keep、标题、takeaway 或填充正文；不为凑页数/填满留白添加套话。
生成正文与整页渲染可分句、压缩重复表达，保留业务含义、数字和原有限定；蓝图混入的明确无关制作说明不照搬、不换写成另一句套话。不得把真正的业务主张或用户要求当作杂项删除。
单页 internal_notes 只存内部工作记录，不进入渲染正文。研究方法本身若属于用户任务，直接写对象、动作与判断标准，不能虚构结果或已完成状态。
在本次输出前自行检查：每句是在讲业务，还是在讲“我/本方案如何制作、思考或保证质量”？后者不输出；自查过程也不输出。无需新增一次审查调用。
本地代码不删改业务文字。文字保真的几何补丁不得删除或改写文案；若必须修改正文，返回 full_rerender，由 SOL 在现有恢复额度内处理，不能绕过门禁。
'''
