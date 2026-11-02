# Insight Desktop documentation

English | [中文](README.zh.md)

## Summary

Start here to maintain Insight Desktop, understand its DSH integration, or diagnose a migration problem. Read the page for the task at hand; the frozen Shell reports are evidence, not a required reading sequence.

## Find the answer

| Your question | Start here |
| --- | --- |
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
