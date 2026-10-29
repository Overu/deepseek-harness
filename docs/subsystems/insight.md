# Insight desktop inputs

English | [中文](insight.zh.md)

## Summary

Insight components keep their existing package and loader identities while using the workspace's DSH implementation. Their manifests are private and their runtime resources belong to the desktop dependency closure. The official Desktop startup, login, and update flow remains unchanged.

## Source ownership

[packages/insight](../../packages/insight/README.md) owns the three source packages. Each package records its upstream repository, commit, and version in `upstream.json`; its workspace version follows the DSH root version. Source changes are committed to the parent repository, and the differences in `patches/insight` support replay against the fixed input. Normal builds do not patch installed files.

The exact identities in [the product roster](../../scripts/insight-package-policy.ts) are checked for private status, version, publication metadata, and unique workspace ownership. The npm baseline excludes only those exact directories. Other package, dependency, and client-module checks remain active.

Canvas and the Memory Client retain their upstream `strict` compiler mode. Those compiler faces do not enable DSH's additional exact optional-property and unchecked-index checks; source intake does not change the existing indexing or optional-value behavior.

`verify:insight-source` checks a local fixed archive and its parent patch against the full authoritative package source. The command verifies the archive digest before extraction, uses an owned temporary directory, and rejects missing, extra, or changed files. It neither fetches inputs nor edits the checkout.

## Skill assets

`bundled-skills` remains an externally synchronized root directory with its original internal structure. The client label generator reads its existing names and `ui.json` files; desktop packaging keeps the directory separate from plugin packages. Skill content, scripts, and business correctness belong to the source repository, not this migration.

The fixed Memory source does not fetch or check out its own Git updates. Component updates belong to the Insight desktop release. Imported UI copy still needs the separate locale migration before product acceptance.

## Desktop integration

The three packages enter the desktop build dependency closure without being mounted by the official profile. Native Insight authentication, account-owned Home selection, and update-source integration are separate from this source intake. Canvas cloud operations still require its account channel and supported browser transport.

## Dev Note

None.
