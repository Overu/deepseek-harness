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
4. Configure `presetSkillIds` on the `insight-skill-center` plugin using technical skill names from catalogue `skill_id`, such as `activity-search`. The Insight bundle selects sixteen technical names. Missing skills install after the account UI is ready, with one cancellable progress overlay and one final notification. Individual skill failures do not stop later installations or trigger retries during that Host lifetime; cancellation stops the queue. Skills previously installed or explicitly removed are not automatically reinstalled or upgraded.
5. Use `installed/<technical-name>.json` records containing `id` (the technical name), `version`, and `payload`; removal history contains only `id`. OSS numeric identifiers are ignored. If development records contain UUID keys and `skillName`, stop the client, back up and remove `$DSH_HOME/platform-skills`, then restart to reinstall. No automatic record migration is provided.
