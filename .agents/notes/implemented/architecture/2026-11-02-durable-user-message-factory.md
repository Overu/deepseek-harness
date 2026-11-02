# Agent Note: Reusable durable user message rows

Status: implemented

English | [中文](2026-11-02-durable-user-message-factory.zh.md)

## Problem

Plugins that decorate historical user messages need native content, attachments, source attribution, timestamps, and copy controls. Extracting a keyed entry's raw React component does not transfer its declared child Slots or injected props. A wrapper can therefore fail when native rendering gains a registration-owned dependency.

## Decision

Chat registers the session-scoped `conversation.chat.user.message` Factory with `UserMessageInput`: a durable user or steering `node` and the caller's authorized `loadImage`. Native keyed entries and Canvas wrappers call this Factory through the framework; neither retrieves the other's component. The Factory owns `conversation.chat.user.before`, and only user rows render that chain. Pending and local-echo rows retain their separate paths.

Canvas parses its existing node-reference protocol and passes a display-only copy to the Factory. Valid tags render as Canvas previews; invalid or unknown tags remain visible. The recorded Session and model-visible input remain unchanged. Canvas registrations follow the node declaration lifetime and do not depend on native entry registration order.

## Alternatives considered

**Copy the complete native message row into Canvas.** This duplicates presentation and requires the plugin to track future native changes.

**Call the raw component with an empty source callback.** This suppresses existing attribution and remains coupled to private registration details.

**Add generic renderer delegation.** A complete-row Factory supplies the current reuse need without extending Slot dispatch.

## Consequences

Native presentation remains shared, while one public Factory must be maintained across baseline updates. Changes to native row inputs, source-child declarations, or registration lifetimes require the real-registration Canvas tests and recorded-session replay. Both plugin load orders, steering, attachments, copy, unload/remount, and unchanged recorded content are regression cases.
