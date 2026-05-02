# Security

This document describes Mnemori's current security posture, the controls in place, and known limitations. It is maintained alongside every code change that affects security.

Last updated: 2026-05-02

---

## Architecture overview

Mnemori is a local-first desktop application. All data — recordings, transcripts, artifacts, and metadata — is stored on the user's machine. No Mnemori-operated servers receive or store user data. External communication is limited to:

1. **OpenAI Whisper API** — audio files are sent for transcription when the user explicitly initiates it
2. **Anthropic Claude API** — transcript text is sent for document generation when the user explicitly initiates it
3. **Clerk** — identity and authentication only. Clerk receives email, name, and session data. It never receives recordings, transcripts, or artifacts. Authentication is optional; unauthenticated users operate as self-sovereign Owners.

Both API calls use HTTPS with API keys the user provides. Clerk communication uses HTTPS — the desktop app opens a modal BrowserWindow to `mnemori.app/auth.html` where Clerk JS runs on the real domain. No Clerk SDK loads in the renderer; only the publishable key is used (no secret keys in client code).

## Data classification

| Data type | Sensitivity | Storage location | Encryption |
|-----------|------------|------------------|------------|
| Screen recordings (.mp4) | High — may contain sensitive on-screen content | Local filesystem (default `userData/recordings/`, configurable by admin) | At rest: none (OS-level FDE recommended) |
| Audio recordings (.wav) | High — contains spoken content | Local filesystem (default `userData/recordings/`, configurable by admin) | At rest: none (OS-level FDE recommended) |
| Transcripts (.txt, .json) | High — verbatim text of speech | Local filesystem (default `userData/recordings/`, configurable by admin) | At rest: none (OS-level FDE recommended) |
| Screenshots (.png) | High — may contain sensitive on-screen content | Local filesystem (default `userData/recordings/`, configurable by admin) | At rest: none (OS-level FDE recommended) |
| Profile & coaching data | Medium — self-reported profile, speech pattern metrics | SQLite database | None |
| Generated artifacts | Medium — derived from transcripts | SQLite database | At rest: none |
| API keys | Critical — grant access to paid APIs | SQLite database | **Encrypted** via Electron safeStorage (DPAPI/Keychain) |
| Settings (device, preferences) | Low | SQLite database | None |
| Audit log | Low — operational metadata | SQLite database | None |
| Clerk identity cache | Low — email, name, role, org | localStorage + SQLite (userId) | None (non-sensitive; no session tokens stored locally — auth handled via browser-based flow) |

## Controls in place

### A.8.24 — Cryptography (credential protection)

API keys are encrypted at rest using Electron's `safeStorage` API, which delegates to the operating system's secure credential store:
- **Windows**: DPAPI (Data Protection API), tied to the user's Windows login session
- **macOS**: Keychain Services

On startup, any plaintext API keys from prior versions are automatically migrated to encrypted storage. The migration is logged in the audit trail. If safeStorage is unavailable (e.g., headless Linux without a keyring), keys fall back to plaintext storage with a logged warning.

Encrypted values are stored with an `enc:` prefix in the database. The encryption key never leaves the OS credential store.

### A.8.15 — Logging and monitoring

All security-relevant actions are recorded in a local `audit_log` SQLite table:

| Event | What is logged | What is NOT logged |
|-------|---------------|-------------------|
| `app:start` | Version, platform, architecture | — |
| `recording:start` | Recording ID, audio device name | Recording content |
| `recording:stop` | Recording ID, duration | — |
| `recording:delete` | Recording ID | File contents |
| `pipeline:transcribe` | Recording ID, success/failure | Transcript content |
| `pipeline:generate` | Recording ID, generation mode, success/failure | Generated content |
| `settings:change` | Setting key, new value | **API key values are never logged** — only "(credential updated)" |
| `credential:migrated` | Key name | Key value |
| `retention:delete` | Recording ID, policy applied | — |
| `settings:storagePath` | New path or "reset to default" | — |
| `screenshot:capture` | Recording ID, timestamp offset | Screenshot content |
| `concepts:extract` | Recording ID, success/failure | Pattern data |
| `concepts:readout` | Session count | Readout content |
| `security:blocked` | Target setting or action, reason | — |

The audit log is append-only during normal operation. It is viewable from the Admin page (Owner/Admin roles only). Log entries include a millisecond-precision timestamp.

**Limitation**: The audit log is stored in the same SQLite database as application data. A user with filesystem access can modify or delete it. For ISO 27001 compliance at scale, the log should be forwarded to an immutable external store.

### A.8.10 — Information deletion (secure delete)

When recordings are deleted — either manually by the user or automatically by the retention policy — all associated files (video, audio, transcript, segment JSON) are securely erased:

1. The file is opened for writing
2. Its entire contents are overwritten with zero bytes
3. The file handle is closed
4. The file is unlinked from the filesystem

**Limitation**: On modern SSDs with wear leveling, overwriting does not guarantee the original data is irrecoverable at the hardware level. Full-disk encryption (BitLocker, FileVault) is recommended for environments handling sensitive data.

### A.8.12 — Data retention

A configurable retention policy allows automatic deletion of recordings older than N days:

- Configured in Admin ("Auto-delete after N days") — Owner/Admin only
- Enforced on every app startup
- Expired recordings are securely deleted (see A.8.10)
- Each auto-deletion is logged in the audit trail
- Recordings actively being recorded are never auto-deleted
- Default: no limit (user must opt in)

### A.8.9 — Access control (process isolation)

Mnemori uses Electron's security model:

- **contextIsolation: true** — the renderer process cannot access Node.js APIs directly
- **nodeIntegration: false** — no `require()` in the renderer
- **sandbox: true** — renderer processes run in Chromium's sandbox, further limiting OS access
- **Preload bridge** — all OS-level operations are exposed through a typed `window.api.*` surface via `contextBridge`. The renderer can only call explicitly exposed functions.
- **Overlay window** — the recording overlay uses a separate minimal preload (`overlay-preload.js`) exposing only `stop`, `getStatus`, `onStarted`, and `onStopped`. It runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `focusable: false`.
- **Permission handler** — only `media`, `mediaKeySystem`, and `audioCapture` permissions are granted to the renderer
- **Single-instance lock** — only one instance of Mnemori can run at a time, preventing SQLite database corruption from concurrent access
- **DevTools disabled in production** — DevTools are automatically closed if opened in packaged builds

### A.8.28 — Secure coding

- No `eval()`, `Function()`, or dynamic code execution
- No `shell.openExternal()` with untrusted URLs
- No `dangerouslySetInnerHTML` — Markdown is rendered via `react-markdown` with `disallowedElements` blocking script, iframe, object, and embed tags
- ffmpeg is spawned with explicit argument arrays (no shell interpolation)
- Database queries use parameterized statements (no string concatenation)
- The `media://` protocol handler validates resolved paths against both the default and custom storage directories — requests for files outside these directories are blocked and logged
- `shell.openPath` and `shell.showItemInFolder` are restricted to `userDataDir` and the active storage directory
- Settings IPC handlers use an allowlist of permitted keys — writes to unknown keys are blocked and logged
- API keys are never returned to the renderer in plaintext — only masked values (first 7 + last 4 characters)
- Content Security Policy restricts script sources to `'self'`, blocking inline scripts and external script injection. Clerk JS no longer loads in the renderer — authentication happens in a separate BrowserWindow on `mnemori.app`.
- Role-based access control enforced at both UI and IPC layers — member role cannot modify API keys, retention policy, storage paths, org feature policies, or view full audit log. Admin settings are on a separate page (`/admin`) that redirects members to `/settings`.
- Storage path changes are validated for writability before acceptance. The `media://` protocol handler and `isSafePath` check both the default and custom storage directories to prevent path traversal.
- Concepts coaching requires explicit user opt-in (consent gate). Org admins can disable Concepts and auto-pipeline org-wide via policy toggles, enforced at the IPC level.
- Admin-only settings (`storagePath`, `policyAutoPipelineDisabled`, `policyConceptsDisabled`) are blocked at the IPC layer for member role — attempts are audit-logged
- The `media://` protocol no longer has `bypassCSP` privilege
- Screenshot copy/save IPC handlers (`screenshot:copy`, `screenshot:save`) validate file paths against storage directories before allowing access
- Bundled export (`system:saveArtifactBundle`) validates each screenshot path before copying — only files within the recordings directory are exported
- Rich copy (`system:copyArtifactRich`) validates screenshot paths before reading file contents for base64 embedding
- Browser-based auth: sign-in opens a modal BrowserWindow to `mnemori.app/auth.html` (the real domain, not localhost). Clerk JS runs on its intended origin — no cookie rewriting, no CORS interceptors, no Origin spoofing. The main process polls `window.__mnemoriUser` via `executeJavaScript` and closes the window after capturing identity data. The auth window uses `contextIsolation: true` and `nodeIntegration: false`.
- Cached auth identity expires after 7 days — stale role/org data is automatically cleared, requiring re-authentication.
- API error handling provides user-friendly messages for network failures, invalid keys, and rate limiting without exposing internal error details.
- Profile IPC handler (`profile:set`) validates keys against an allowlist — writes to unknown keys are blocked and audit-logged
- Retention days validation rejects negative or non-numeric values at the IPC layer
- API keys are trimmed of whitespace before encryption and storage
- Recording IDs include a cryptographic random suffix to prevent timestamp-based collisions
- Disk space check before recording — refuses to start if less than 500 MB available
- Deletion operations (`recordings:delete`, `enforceRetention`) are wrapped in SQLite transactions to prevent partial cleanup on failure
- Global `uncaughtException` and `unhandledRejection` handlers prevent silent crashes — errors are logged to the audit trail
- Graceful shutdown: `will-quit` kills active ffmpeg processes, marks in-progress recordings as errored, and closes the database connection
- Startup sweep: stale `status='recording'` rows from prior crashes are automatically marked as errored
- Production CSP: in packaged builds, Content Security Policy is set via session headers without `ws://localhost:*` — the dev-only websocket directive is stripped
- Hotkey management: `hotkey:clear` unregisters only the specific recording hotkey instead of all global shortcuts
- Duplicate project names are rejected at the IPC layer
- React ErrorBoundary catches renderer crashes with a recovery UI instead of a white screen

## Known limitations and residual risks

| Risk | Severity | Mitigation | Status |
|------|----------|-----------|--------|
| Recordings/transcripts not encrypted at rest | Medium | Recommend OS-level full-disk encryption. Application-level encryption planned for v2. | Open |
| Audit log is mutable by local user | Low | Acceptable for single-user desktop app. External log forwarding planned for SaaS version. | Open |
| SSD wear leveling may preserve deleted data | Low | Recommend BitLocker/FileVault. Cannot be fully mitigated at application level. | Accepted |
| No Content Security Policy header | Medium | CSP meta tag added restricting script-src to 'self'. | **Fixed** |
| API keys sent to OpenAI/Anthropic over HTTPS | Low | Standard API usage. Keys are user-provided and user-controlled. | Accepted |
| No application-level authentication | Medium | Clerk auth implemented (optional). Unauthenticated users default to Owner. Role enforcement at UI + IPC. | **Fixed** |
| Unsigned application binary | Medium | SmartScreen/Gatekeeper warnings on first run. Code signing with Third Feather Capital Inc certificate planned pre-launch. | Open |
| ffmpeg binary not integrity-checked | Low | Bundled via ffmpeg-static (npm verified). System ffmpeg falls back to PATH. | Open |

## Dependency vulnerabilities (npm audit 2026-05-01)

| Package | Severity | Issue | Ships to users? | Action |
|---------|----------|-------|-----------------|--------|
| `electron@33` | High | 18 CVEs including ASAR integrity bypass, IPC spoofing, use-after-free | **Yes** — runtime | Upgrade to electron@41+. Breaking change — requires testing. |
| `tar` (via electron-builder) | High | Path traversal via hardlinks/symlinks | No — build tool only | Upgrade electron-builder to 26.8+. |
| `esbuild` (via vite) | Moderate | Dev server request forgery | No — dev tool only | Upgrade vite to 6+. |
| `@tootallnate/once` | Low | Incorrect control flow scoping | No — build tool only | Upgrade electron-builder to 26.8+. |

**Assessment**: The electron@33 vulnerabilities are the only ones that ship to end users. Most require specific attack conditions (service workers, protocol handlers, shared renderer processes) that Mnemori's architecture mitigates — contextIsolation is enabled, no custom protocol handlers call `shell.openExternal`, and no service workers are registered. However, upgrading Electron is the correct remediation and should be prioritized.

The build-tool vulnerabilities (`tar`, `esbuild`, `@tootallnate/once`) only affect the development/CI environment and do not ship in the packaged application.

## Vulnerability scan log

| Date | Scanner | Findings | Remediation |
|------|---------|----------|-------------|
| 2026-05-01 | Manual code review + npm audit | 2 critical (media:// path traversal, unrestricted shell APIs), 3 high (settings allowlist, key exposure to renderer, no CSP), 2 medium (Markdown sanitization, audit limit), 1 low (audit log value leakage), 14 npm dep vulnerabilities | All application-level findings fixed. Electron upgrade pending. |
| 2026-05-01 | Pre-launch gap assessment (86 items) | 6 critical (single-instance, error handlers, graceful shutdown, ErrorBoundary, transactional deletion, text selection), 12 high (sandbox, profile allowlist, CSP hardening, load/save error handling), 15 medium (hotkey fix, disk space, escape key, accessibility, validation, DevTools) | All code-fixable items resolved. Electron upgrade and code signing remain open. |

## Supplier security

| Supplier | Data shared | Purpose | Data retention by supplier |
|----------|-----------|---------|---------------------------|
| OpenAI | Audio files (.wav) | Whisper transcription | Per OpenAI API data usage policy — not used for training via API |
| Anthropic | Transcript text | Claude document generation | Per Anthropic API policy — not used for training via API |

| Clerk | Email, name, session data | Authentication and identity | Per Clerk privacy policy — SOC 2 Type II certified |

All suppliers are accessed only when the user explicitly initiates an action, except Clerk which communicates session data on sign-in. No background data transmission of recordings, transcripts, or artifacts occurs.

## Incident response

Not yet formalized. For the current single-user desktop phase:

1. If a vulnerability is discovered, update the application and re-build
2. If API keys are compromised, rotate them immediately via the provider's console
3. If recordings contain sensitive data that was inadvertently captured, use the delete function (secure overwrite) and verify deletion via the audit log

A formal incident response plan will be documented in `compliance/` as part of the ISO 27001 preparation work.

## Reporting vulnerabilities

If you discover a security issue in Mnemori, contact the maintainer directly. Do not open a public GitHub issue for security vulnerabilities.
