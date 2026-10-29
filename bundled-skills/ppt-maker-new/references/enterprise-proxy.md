# Enterprise proxy runtime

Python business scripts invoke the bundled `enterprise_proxy.py` adapter and
`enterprise_proxy.mjs` using the client's Node runtime. The plugin supplies
DSH_HOME and DSH_SKILL_PROXY_NODE and attaches the logged-in user identity.
The skill does not read user tokens or vendor credentials. No direct-call fallback.

- Text and approved image-bearing requests: connection `ppt-text`, POST `/chat/completions`.
- Image: connection `media-generator`, POST `/v1/proxy`, task `text_to_image`.
- Backend API: POST `/api/skill-proxy/{connection_id}`; only configured routes allowed.
- Server keys: TX_CLOUD_API_KEY, MG_API_AK, MG_API_SK. PPT_UPSTREAM_MODEL controls
  the text/visual model; this skill requests gpt-6.1-sol by default. A server
  override can select another model, independently of DeepSeek chat.
- `doctor` reports local proxy prerequisites only. `server_credentials=not_checked`
  is not evidence of a working login, configured server keys or upstream availability.

All PPT projects in the same DSH home share ten cross-process request slots using
the bundled host lock adapter (POSIX flock or Windows byte locks). This does not
reserve backend capacity against other skills/devices;
a backend 429 stops the run. Do not bypass limits by changing project/run IDs.
Requests retain NDJSON heartbeats, not streaming model content. Proxy failures
are not retried. A managed run records a stop marker after a proxy error, so
queued workers cannot silently continue paid requests. Already in-flight calls
may complete. Inspect the failure and existing outputs before an explicit resume.
An unknown outcome requires reconciliation/user confirmation, not blind retry.

Optional image attachments are encoded in memory as JPEG (long edge <=1920,
<=400 KiB each), without modifying original evidence. This release has no
PPTX-to-screenshot visual-review stage. The complete request must fit the 2 MiB
envelope limit; oversized requests fail before sending. Do not split a
failed/unknown paid call automatically.

PPTX construction, cache, rendering and downloaded assets stay local. Python and
the dependencies in `requirements.txt` are required; this skill does not package
Python into the desktop installer. The bundled Windows host/lock adapter still
requires native client acceptance; macOS offline tests do not establish Windows
gateway or background-job compatibility.
Frozen runtimes of already-started projects retain their old code; finish or stop
the old job before starting a new run from this updated skill. Never hot-patch a
running project's frozen runtime.
