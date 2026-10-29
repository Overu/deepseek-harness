# User-requested changes to accepted pages

Ordinary defect recovery still targets unresolved pages only. When a user explicitly
requests edits to already passing pages (including human-discovered author notes),
submit those targets through the separate managed revision lane:

```bash
python3 <skill>/scripts/ppt.py start --stage revise --project <project> --pages 8,20 --instruction-file <changes.txt>
python3 <skill>/scripts/ppt.py wait --project <project> --wait-seconds 20
```

On a verified DSH native managed job the equivalent is `ppt.py revise --project
<project> --pages 8,20 --instruction-file <changes.txt>`. Normal status, cancel,
frozen snapshot and project lock apply. --pages here is a selector, not deck count.
Do not combine this action with --repair-pages, --extra-calls or --replace-plan.
The user's request is the edit authority; no synthetic defect or approval ID.

The instruction file states the requested change and protected meaning. Example:
“仅修改第8、20页，去掉描述作者如何处理材料的正文备注，保留业务结论、事实、来源
和限定条件；同步更新相应蓝图，不修改其余页面。” DSH records this request, not replacement
business copy. Ambiguous business qualifiers are not automatically deleted.
Saved original planning extra requirements are included losslessly in the SOL
revision input; a conflicting current user instruction has priority. The request
identity also includes planning-request and Brief hashes, so changed upstream
requirements cannot silently reuse a response from another input scope.

SOL returns one complete page blueprint plus exact SML per target. Facts, source
references, must_keep/verbatim fields, role and image demand remain protected.
Content authority changes belong in Brief, not this lane. No new imagery is bought.
Current support is best-effort projects; strict projects retain their existing
workflow. Legacy visual settings do not enable a removed review stage.

All requested candidates must pass their current checks before accepted content
changes. Blueprint, selected SML/caches, planning checkpoints and output are committed
as one recoverable transaction. Other pages' content is reused; full-count assembly,
source/assets and whole-deck local checks remain in force. Failure restores the old
PPTX and acceptance records; saved responses and actual usage are never rolled back.
Interrupted prepared transactions recover under the managed project lock on resume.

Each target has one response opportunity for this instruction/base identity, separate
from ordinary defect-repair history and charged to user_revision under the explicit
project cap. There is no automatic retry loop in this user-edit lane. Saved responses
are replayed on duplicate requests; a real changed request/base defines new work.
An uncertain request without a saved matching response still requires reconciliation.
If revision fails, the original delivered deck remains usable; don't claim the edit
was applied or rerun the same paid request blindly. Inspect the saved candidate and
report what prevented the change. Ordinary build/closing policy remains unchanged.

After success use the exact snapshot from status to publish. `quality_message`
describes current checks; needs_attention is a compatible runtime label, not proof
of remaining defective pages. All outputs still disclose 未进行视觉验收.
Lexical/structural QA cannot prove semantic perfection; no extra full-deck model
review is scheduled merely because this edit lane exists.
