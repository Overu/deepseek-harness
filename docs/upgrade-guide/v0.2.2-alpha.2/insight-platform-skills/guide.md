---
kind: upgrade-guide
description: "Insight Desktop platform skills now install per account instead of shipping in the application bundle."
---

# Insight platform skill installation

English | [中文](guide.zh.md)

## Change

Insight Desktop no longer ships skills in the application's `bundled-skills` directory. Platform skills now install into the current account's local data through Skill center and appear in Expert skills → Platform presets. An existing legacy directory remains discoverable read-only under user skills; application updates may still replace that directory. Skill center owns both installation and the expert picker.

## Migration

1. Open Skill center after signing in and select **Install** for each platform skill you need. Select **Update** when the catalog provides a newer version.
2. Confirm the installed skill appears under Expert skills → Platform presets. Use **Remove** in Skill center to remove it from that account.
3. Copy any user-maintained files from the old application directory into `$DSH_HOME/skills`; read-only legacy discovery cannot recover files already replaced by an updater. Account-local platform skills persist across application updates and reinstallation on the same device.
4. Configure `presetSkillIds` on the `insight-skill-center` plugin using OSS `id` values written as strings. The Insight bundle selects `1`, `2`, and `3`; entries without an OSS ID use a technical-name selector. Missing skills install after the account UI is ready, with cancellable progress; skills previously installed or explicitly removed are not automatically reinstalled or upgraded.
5. Use the first-release installation records containing a local `key`, optional OSS `id`, and required `skillName`. Matching uses IDs first, then a unique technical name when either side lacks an ID. Earlier development record formats have no migration reader.
