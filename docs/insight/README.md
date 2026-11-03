# Insight Desktop documentation

English | [中文](README.zh.md)

## Summary

P6 documentation closure and the remaining-work handoff completed on 2026-11-03; migration work is now at rest. The [closure record](history/p6-closeout.md) pins the source and artifact baselines. Use the table below for maintenance, later releases, and bugs; those tasks do not restart the migration stage by default.

## Find the answer

| Your question | Start here |
| --- | --- |
| Is P6 closed, and how does source differ from published installers? | [Closure record](history/p6-closeout.md), [delivery state](operations.md#current-delivery-state) |
| What was migrated, retained, or excluded? | [Migration summary](migration-summary.md) |
| How do login, account data, the Host, and plugins connect? | [Architecture](architecture.md) |
| Why did we change official DSH files, and what must survive an upstream update? | [Baseline changes](baseline-changes.md) |
| How do I develop, build, publish, or recover from a known failure? | [Operations](operations.md) |
| What remains open, why, and when should we act? | [Follow-ups](follow-ups.md) |
| Which original report or acceptance record supports a decision? | [Historical evidence](history.md) |

## Documentation ownership

These pages own Insight product decisions, migration outcomes, and maintenance guidance. Package READMEs own package behavior and configuration; [release scripts](../../scripts/insight-release/README.md) own the publication protocol; the [generated subsystem API](../subsystems/insight.md) owns the account service API. Links connect these owners instead of copying their implementation details.

Current pages are maintained in both languages. Frozen history preserves the source language, decisions, and test results from the recorded date. A failed historical check remains failed unless a later record closes it; a pending check does not mean a missing implementation.

## Dev Note

None.
