# Changelog

All notable changes to Mnemori are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/). Dates are ISO 8601.

---

## [0.6.3] — 2026-05-07

### Fixed
- **macOS Intel CI builds** — Replaced deprecated `macos-13` runner (perpetually queued) with `macos-latest` cross-compiling for x64. Intel builds now complete reliably.

### Changed
- **Re-enabled macOS notarization** — Apple Developer account provisioning has propagated. Builds are now notarized and stapled, so macOS users no longer need to bypass Gatekeeper.
- **Version bump** — 0.6.2 to 0.6.3.

---

## [0.6.2] — 2026-05-06

### Fixed
- **macOS app failed to launch on first open** — `app.asar` was being recursively packed with its own previous build output, swelling to 940 MB and corrupting the asar offset table. Electron failed to parse `package.json` from the asar at startup and exited silently with code 1, presenting as "click Open Anyway → app crashes." Resolved by directing electron-builder output to `release/` so it no longer collides with the Vite renderer output in `dist/`. New asar size is ~23 MB.

### Removed
- **Redundant `build-mac-intel.yml` workflow** — Intel macOS is now built via the matrix in `build.yml`. The standalone workflow created a publish race condition.

---

## [0.6.1] — 2026-05-05

### Added
- **Encryption at rest (AES-256-GCM)** — All recordings, transcripts, screenshots, and segment data can now be encrypted with AES-256-GCM. Each file gets a unique key derived via HKDF from a master key stored in the OS secure credential store (Windows DPAPI / macOS Keychain). File format: 4-byte magic (`MNMR`) + version byte + 12-byte IV + 16-byte auth tag + ciphertext. Transparent decryption on read — video playback, transcript access, and export all work seamlessly. Enable via Admin → "Enable encryption" button. Migrates existing unencrypted files in-place with progress reporting.
- **Encryption IPC handlers** — `encryption:status`, `encryption:enable`, `encryption:disable` handlers with role-based access control (admin/owner only).
- **Admin encryption panel** — New "Encryption at rest" section in Administration page showing status, enable/disable controls, and migration progress indicator.

### Changed
- **Version bump** — 0.6.0 to 0.6.1.

---

## [0.6.0] — 2026-05-05

### Added (enterprise hardening)
- **Cryptographic audit log chaining** — Every audit log entry now includes a SHA-256 hash of the previous entry, creating a tamper-evident chain. If any entry is modified or deleted, the chain breaks and the tampering is detectable. New `audit:verify` IPC handler walks the full chain and reports integrity status. "Verify audit integrity" button added to the Admin page. Satisfies SOC 2 CC7.2 and ISO 27001 A.8.15.
- **ffmpeg binary integrity verification** — On startup, the bundled ffmpeg binary's SHA-256 hash is compared against a known-good hash generated at build time (`ffmpeg-integrity.json`). Mismatches are logged to the audit trail. Build script `scripts/generate-ffmpeg-hash.js` computes the hash during CI.
- **SBOM generation in CI** — CycloneDX Software Bill of Materials is now generated during every build and uploaded as a build artifact. Production dependency audit (`npm audit --omit=dev --audit-level=high`) added as a CI step.
- **Code signing CI preparation** — Build workflow now supports code signing when certificates are provided via GitHub secrets (`CSC_LINK`, `CSC_KEY_PASSWORD` for Windows; `CSC_LINK_MAC`, `APPLE_ID`, `APPLE_TEAM_ID` for macOS). Auto-discovery is dynamically enabled only when secrets are present. `signingHashAlgorithms: ['sha256']` added to Windows build config.
- **Incident Response Plan** — Formal incident response plan at `compliance/INCIDENT_RESPONSE.md`. Covers: roles and responsibilities, P1-P4 severity classification with response SLAs, detection sources, containment procedures per scenario, communication templates with GDPR notification timeline, post-mortem process.
- **Data Processing Addendum (DPA)** — Draft DPA at `compliance/DPA.md` for enterprise customers. Covers: data flows, lawful basis, subprocessor list with data residency, data subject rights, security measures, breach notification, audit rights. Notes cross-border transfer mechanisms (SCCs) for EU customers.

### Changed
- **Electron 33 to 41** — Upgraded Electron runtime from v33 (18 known CVEs) to v41 (zero production vulnerabilities). All APIs compatible — no breaking changes.
- **Auth window sandbox** — Auth BrowserWindow now runs with `sandbox: true` for consistency with main and overlay windows.
- **Version bump** — package.json updated from 0.5.1 to 0.6.0.

---

## [0.5.1] — 2026-05-05

### Added
- **Library reasoning density indicator** — Each recording row in the Library shows a small colored dot indicating how much "why" reasoning the recording contains: thin (grey), moderate (soft ember), or rich (moss green). Hover for the exact percentage. Only appears for recordings with Concepts extraction data.
- **Recording detail reasoning sidebar** — The recording detail sidebar now shows the reasoning density score with a labeled indicator (Thin/Moderate/Rich) and percentage when insight data is available.
- **Project-level decay alerts** — The project detail view now shows active documentation decay alerts for all recordings in the project. Each alert shows the artifact mode, divergence summary, and a "View recording" link to investigate and resolve.
- **Project decay data in API** — `projects:get` IPC handler now returns `decayAlerts` array with active decay alerts for all recordings in the project.
- **Reasoning density in recording list** — `recordings:list` IPC handler now includes `reasoning_density` from profile insights for each recording.

### Added (privacy hardening)
- **Decay detection opt-in toggle** — Decay detection is now gated behind an explicit "Detect outdated documentation" checkbox in Settings (disabled by default). Help text explains that it sends artifact content to Anthropic. Previously ran automatically for any project-tagged recording.
- **"What leaves your machine" transparency table** — New section at the bottom of the Settings page listing every external data flow: what data, where it goes, and what user action triggers it. Fulfills the core design principle of showing exactly what leaves the machine.
- **Secure temp file deletion** — Auto-chunking temp WAV files are now securely deleted (zero-fill overwrite) rather than standard unlinked.

### Changed
- **CLAUDE.md updated** — Known limitations section corrected to reflect that auto-chunking removes the 90-minute recording ceiling.
- **Version bump** — package.json updated from 0.5.0 to 0.5.1.

---

## [0.5.0] — 2026-05-05

### Added
- **Multi-format output** — Two new artifact modes: **Checklist** (numbered `- [ ]` action items) and **Executive summary** (3-8 sentence briefing for stakeholders). Both available as generation chips on every recording, as auto-pipeline defaults, and as project-level defaults.
- **Generate all formats** — One-click button on the recording detail page generates all 6 artifact types (SOP, Methodology, Coaching, Notes, Checklist, Executive summary) sequentially from a single transcript. Progressive UI shows which format is generating. Exposed via `pipeline:generateAll` IPC handler.
- **Documentation decay detection** — When you record yourself doing something that already has documentation in the same project, Mnemori compares the new transcript against existing artifacts. If the process has changed, a decay alert surfaces on the recording detail page with the divergence summary. One-click actions: **Update artifact** (regenerates from new recording) or **Dismiss**. Library page shows a banner when documents may be outdated. New `decay_alerts` table with full audit trail. Opt-in via Settings (disabled by default) — sends artifact content to Anthropic for comparison.
- **Whisper auto-chunking** — Recordings longer than ~90 minutes (WAV files > 24MB) are automatically split into 10-minute chunks, transcribed sequentially, and merged with correct timestamp offsets. Progress indicator shows "Transcribing — chunk 2 of 4..." during multi-chunk transcription. Removes the previous file-size ceiling on recording length. Temp chunk files cleaned up in `try/finally`.
- **Context-aware default artifact type** — Projects can now specify a default artifact type (e.g., Consulting project → Methodology, Training project → SOP). When auto-pipeline runs after recording, it checks the project's default before falling back to the global setting. Dropdown appears on the project detail page. New `projects:update` IPC handler.
- **Low-confidence flagging in transcripts** — Whisper's segment-level confidence data (`no_speech_prob`, `avg_logprob`, `compression_ratio`) is now preserved in the segments JSON. Segments with low transcription confidence are rendered with reduced opacity and a dashed underline. Hover shows confidence percentage. A legend appears when low-confidence segments are present: "Dimmed segments may contain transcription errors." Existing recordings without confidence data render normally.
- **Reasoning density scoring** — The Concepts extraction prompt now returns a `reasoning_density` score (0.0–1.0) measuring how much "why" reasoning a recording contains, plus `reasoning_examples` with direct quotes. Stored in `profile_insights` and available as a goal metric in the Concepts dashboard. Helps users learn to narrate more effectively.

### Changed
- **Version bump** — package.json updated from 0.3.5 to 0.5.0.
- **Recording deletion cleanup** — Decay alerts are now cleaned up when a recording is deleted.

---

## [0.3.5] — 2026-05-05

### Added
- **Custom prompts** — Create your own generation prompts in Settings. Each custom prompt gets a name and prompt text, appears alongside the four built-in modes (SOP, Methodology, Coaching, Notes) on every recording's detail page, and can be set as the default for auto-pipeline. Use `{transcript}` in your prompt text to control where the transcript is inserted. Stored in SQLite, CRUD managed via IPC with full audit logging.
- **Custom prompts in auto-pipeline** — The auto-generate dropdown in Settings now includes your custom prompts. Select one and it runs automatically after transcription, just like the built-in modes.

---

## [0.3.2] — 2026-05-05

### Added
- **Auto-updates** — The app checks for updates on launch and downloads them in the background. When a new version is ready, a subtle banner appears in the sidebar offering to restart. Updates install silently on quit — no manual re-downloading required. Powered by `electron-updater` with GitHub Releases as the update source.
- **Manual update check** — `update:check` IPC handler available for future UI integration (e.g. "Check for updates" button in Settings).

### Changed
- **CI publishes update manifests** — Build workflow now runs `electron-builder --publish always`, which uploads `latest.yml` and `latest-mac.yml` alongside installers. These files are what the auto-updater reads to detect new versions.
- **macOS zip target** — macOS builds now produce both DMG (for first-time download) and zip (required for auto-update delivery).
- **Repository URL corrected** — package.json `repository.url` now points to the actual GitHub repo (`T0170/mnemori`).

---

## [0.3.1] — 2026-05-01

### Added
- **Bundled API keys for early access** — CI builds inject default OpenAI and Anthropic keys from GitHub Secrets. Users can start transcribing and generating immediately without configuring their own keys. User-configured keys take priority when present.

### Fixed
- **CI release tagging** — Version extraction switched from `node -p` (broken nested quoting on Ubuntu) to `jq` for reliable `v0.3.x` tags.
- **Download button routing** — Releases marked as non-prerelease so GitHub's `/releases/latest` URL resolves correctly for the marketing site download buttons.

---

## [0.3.0] — 2026-05-01

### Added
- **Screenshot capture during recording** — Capture a screenshot at any moment during an active recording. Triggered via the overlay's capture button or the global hotkey `Ctrl+Shift+S` (registered only while recording). Screenshots are timestamped relative to recording start and stored as PNG files alongside the video and audio.
- **Screenshots in transcript timeline** — Screenshots appear inline with transcript segments at their chronological position. Click a screenshot to seek the video to that moment. When no transcript segments are available, screenshots appear below the transcript text.
- **Screenshot count in detail sidebar** — Recording detail page shows the number of captures in the sidebar panel.
- **Overlay capture button** — Small viewfinder-style button between the timer and stop button. Flashes briefly on capture for visual feedback.
- **Screenshot lifecycle** — Screenshots are securely deleted (zero-fill overwrite) when a recording is deleted or expired by the retention policy. Served via the `media://` protocol with path validation.
- **Snap button in sidebar** — "Snap" button appears in the sidebar recording card during active recording, alongside the Stop button. Flashes briefly on capture.
- **Screenshot-aware artifact generation** — When generating artifacts (SOP, Methodology, Coaching, Notes), screenshots are sent to Claude as images alongside the transcript. Each screenshot includes its timestamp and surrounding transcript context. Claude weaves visual references into the generated content — labeling what's on screen and tying it to the narrated discussion.
- **Inline screenshot images in artifacts** — Generated artifacts that reference "Screenshot at X:XX" now display the actual captured screenshot image inline below the reference. Screenshots are matched to their timestamp and rendered within the markdown content.
- **Screenshot gallery** — The "captures" count in the detail sidebar is now clickable. Opens a scrollable gallery modal showing all captured screenshots at full width, each with its timestamp and surrounding transcript context as commentary. Click any screenshot to seek the video to that moment.
- **Bundled artifact export** — "Save .md" on artifacts with screenshots exports a markdown file plus an `_images` folder containing all referenced screenshots as PNGs. Image paths in the markdown are rewritten to relative references, so the export works immediately in Obsidian, GitHub, Notion, Confluence, or any markdown viewer.
- **Screenshot copy/save** — Hover any screenshot (in transcript, artifact, or gallery) to reveal Copy and Save buttons. Copy puts the image on the system clipboard; Save opens a native file dialog to export the PNG.
- **Rich copy with images** — "Copy" on artifacts with screenshots puts both rich HTML (with base64-embedded images) and markdown text on the clipboard. Paste into Google Docs, Notion, Confluence, or Word and screenshots appear inline automatically. Paste into a text editor and you get the raw markdown.

### Changed
- **CSP `img-src` update** — Added `media:` to Content Security Policy `img-src` directive so screenshot images load via the `media://` protocol.
- **Markdown `urlTransform`** — Custom URL transform in react-markdown allows `media://` protocol URLs for inline screenshot rendering (default strips non-standard protocols).
- **Save .md path sanitization** — Bundled export folder names use only alphanumeric characters, hyphens, and underscores to ensure compatibility across all markdown renderers and operating systems.
- **Version bump** — package.json updated from 0.2.1 to 0.3.0.
- **App icon** — Custom Mnemori icon (ember M on cream) used for window, taskbar, installer, and favicon. Generated at 16/32/48/64/128/256/512px.
- **Publisher metadata** — package.json now includes author (Third Feather Capital Inc), license, homepage, and repository fields.
- **NSIS installer** — Configurable install directory, custom icons, per-user installation default.

### Security
- **Single-instance lock** — `app.requestSingleInstanceLock()` prevents multiple instances from corrupting the SQLite database. Second instance focuses the existing window.
- **Global error handlers** — `uncaughtException` and `unhandledRejection` handlers prevent silent crashes. Errors are logged to the audit trail.
- **Graceful shutdown** — `will-quit` now kills active ffmpeg processes, marks in-progress recordings as errored, and closes the database connection cleanly.
- **Stale recording cleanup** — On startup, any recordings left in `status='recording'` from a prior crash are marked as errored.
- **Transactional deletion** — `recordings:delete` and `enforceRetention` wrap all DB deletions in `db.transaction()` to prevent partial cleanup.
- **Renderer sandbox** — `sandbox: true` added to all BrowserWindow webPreferences (main window and overlay).
- **Profile key allowlist** — `profile:set` IPC handler validates keys against an allowlist. Writes to unknown keys are blocked and audit-logged.
- **Hotkey clear fix** — `hotkey:clear` now unregisters only the specific recording hotkey instead of calling `globalShortcut.unregisterAll()`, preserving the screenshot hotkey.
- **Retention days validation** — `settings:set` rejects negative or non-numeric retention day values.
- **API key trimming** — API keys are trimmed of leading/trailing whitespace before storage.
- **Duplicate project guard** — `projects:create` checks for existing projects with the same name before inserting.
- **Recording ID collision prevention** — Recording IDs now include a random hex suffix (`rec_timestamp_random`) to prevent collisions.
- **Disk space check** — Recording refuses to start if less than 500 MB of free disk space is available.
- **Production CSP hardening** — In production builds, CSP is set via session headers without `ws://localhost:*` (dev-only websocket directive).
- **DevTools disabled in production** — DevTools automatically close if opened in packaged builds.
- **React ErrorBoundary** — Wraps all Routes in App.jsx. Catches render errors gracefully with a recovery UI instead of a white screen.
- **Text selection** — `user-select: text` added to artifact content, transcript, project summaries, and gallery context so users can select and copy text.

### Fixed
- **Escape key closes modals** — Confirm dialogs and screenshot gallery now dismiss on Escape keypress.
- **Loading states** — RecordingDetail shows a loading indicator instead of rendering nothing while data loads. Library, Settings, Admin, and Concepts load functions wrapped in try/catch/finally to prevent stuck loading states.
- **Save error handling** — Settings save, Admin save, and Concepts operations wrapped in try/catch with toast error feedback.
- **Safe JSON.parse in Concepts** — Aggregation of topics, concepts, strengths, and growth edges uses a safe parser that falls back to empty array on malformed data.
- **Accessibility** — Gallery modal has `role="dialog"` and `aria-modal`. Assign-to-project icon has `role="button"` and `aria-label`.

---

## [0.2.1] — 2026-05-01

### Added
- **Global hotkey** — System-wide `Ctrl+Shift+M` (configurable) toggles recording from any application, even with Mnemori minimized. Uses Electron `globalShortcut` API. Configurable in Settings with Apply/Disable controls and registration error feedback. Default chosen for universal keyboard compatibility (no function keys).
- **Floating recording overlay** — Frameless, always-on-top, transparent window appears bottom-right while recording. Shows a live timer (JetBrains Mono) and a stop button. Draggable, non-focusable (won't steal focus from your current app). Auto-hides when recording stops.
- **Recording guard** — Start Recording button disabled in sidebar when no microphone is configured, with hint to visit Settings. Hotkey shows an OS error dialog if recording fails. Prevents creation of corrupt recordings.
- **ffmpeg crash detection** — If ffmpeg exits immediately (bad device, missing codec), no recording is created and the error is surfaced. Mid-recording ffmpeg crashes are detected and the recording is marked as errored. On stop, corrupt/empty video files are flagged instead of producing broken entries.
- **Synced transcript playback** — Transcript renders as clickable segments with timestamps. Click any sentence to seek the video to that moment. During playback, the active segment highlights and auto-scrolls into view. Auto-scroll pauses when the user manually scrolls, resumes after 4 seconds of inactivity. Video scrubber seeking also works via byte-range protocol support.
- **Export everywhere** — "Copy plain" (strips Markdown) and "Save .md/.txt" (native save dialog) buttons on artifacts, transcripts, and project summaries. Consistent export surface across all generated content.
- **Auto-pipeline** — Optional auto-transcribe and auto-generate after recording stops. Both disabled by default. Configurable in Settings with checkboxes and artifact type dropdown. Respects the principle that all API calls should be intentional unless the user explicitly opts in.
- **Full-text search** — Library search now queries across transcript and artifact content via SQLite FTS5 (Porter stemming). Title/project/tag matches appear first; content matches show below with context snippets. Existing recordings are indexed on first startup.
- **Concepts coaching dashboard** — New Concepts page with step-by-step onboarding survey (name, role, goals, challenges, confidence), profile editor, and coaching dashboard. Extracts communication patterns (fillers, hedging, confidence, strengths, growth edges, topics, terminology) from each transcription via Claude. Dashboard shows aggregated stats, recurring strengths and growth edges, topic/concept tags with frequency counts, and a personalized coaching readout. Backfill button analyzes existing recordings. Auto-extraction opt-in via Settings.
- **Voice input for profile** — Each profile question has an optional mic button. Click to record a spoken answer; the audio is transcribed via Whisper and appended to the text field. Spoken memory app, spoken entry. Text input remains the default for those who prefer typing.
- **Personal goals and milestones** — Set trackable goals on the Concepts dashboard (reduce fillers, improve confidence, etc.). Each goal maps to a metric extracted from sessions. Click a goal to see a bar chart of historical values. Milestone awards are computed automatically: "Trending" when your recent average improves over your early average, "Streak" for consecutive improvement, "Mastered" when you hit the target. Awards show as pill badges on the goal card.
- **Admin panel** — New Administration page under Configure (visible to Owner/Admin roles only). Contains API key management, data retention policy, storage path configuration, organization-wide feature policies, and security audit log. Members see only the Settings page with personal preferences.
- **Settings/Admin split** — Settings page slimmed to user-level controls only: account, audio device, hotkey, auto-pipeline preferences. Org-level controls moved to Admin. Auto-pipeline section shows a policy notice when disabled org-wide.
- **Concepts opt-in gate** — Consent screen on first Concepts visit explaining token consumption and speech pattern analysis. Explicit "Enable Concepts" button required before onboarding survey. "Disable Concepts" button available at bottom of dashboard. Org-wide disable policy enforced in both UI and backend.
- **Storage path configuration** — Admins can point recording storage to a custom directory (OneDrive, Google Drive mount, NAS, compliance-approved path). Native folder picker with writability validation. New recordings go to the configured path; existing recordings remain accessible from their original locations.
- **Organization feature policies** — Admin toggles to disable auto-pipeline and Concepts org-wide, controlling token consumption across all users. Enforced at the IPC level.
- **Library search and sort** — Search input filters recordings by title, project, and tags. Sort dropdown: newest, oldest, longest, or alphabetical. Count updates to show filtered results (e.g. "3 of 12").
- **Assign to project from Library** — Each recording row has a § icon that opens a project dropdown. Assign or remove a project without navigating away from the Library.
- **Loading indicators** — Animated progress bar with contextual message appears during transcription and generation. Helps orient the user during long operations.
- **Project overview snippet** — Project list rows show the first ~160 characters of the summary (Markdown stripped) so users can distinguish projects at a glance.
- **Copy project summary** — Copy button on project detail view copies the raw Markdown summary to clipboard.
- **Google OAuth** — Configured Google OAuth credentials in Clerk production instance. Google sign-in now works alongside email/password.

### Changed
- **Toast queue** — Multiple toasts now stack instead of overwriting. Up to 5 toasts visible simultaneously, each auto-dismisses after 3 seconds.
- **Custom confirmation dialogs** — Destructive actions (delete recording, delete project) now show an in-app confirmation dialog instead of the browser's native `confirm()`.
- **Network error messages** — API call failures (OpenAI Whisper, Anthropic Claude) now show user-friendly messages for common errors: no internet, invalid API key, rate limiting.
- **Auth cache expiry** — Cached identity expires after 7 days, requiring re-authentication. Prevents stale role/org data.
- **Loading states** — Library, Admin, and Concepts pages show a loading indicator instead of a blank screen during initial data load.
- **Search query sanitization** — FTS5 search now preserves hyphens and periods in search terms while still stripping FTS5 special characters.
- **Shared `stripMarkdown` utility** — Extracted to `src/renderer/lib/format.js`, removing duplication from RecordingDetail and Projects.
- **Overlay preload cleanup** — IPC listeners in overlay preload now return unsubscribe functions for proper cleanup.
- **Version bump** — package.json updated from 0.1.0 to 0.2.1.

### Fixed
- **Concepts policy in auto-pipeline** — `policyConceptsDisabled` is now checked during auto-pipeline's concept extraction step, preventing extraction when the org has disabled Concepts.
- **SQL column safety in goals** — `goals:history` uses a mapping object instead of Set-guarded string interpolation for the column name.
- **Voice input error message** — `pipeline:transcribeBlob` now correctly references "Administration" instead of "Settings" for API key configuration.

### Removed
- **`python-backend/` directory** — Vestigial Python backend files removed. All API calls run natively in Node.js.

---

## [0.2.0] — 2026-05-01

### Changed
- **Auth architecture** — Replaced in-app Clerk SDK with browser-based sign-in. The desktop app opens a modal BrowserWindow to `mnemori.app/auth.html` for authentication, then captures the user data via IPC. This bypasses all CORS, cookie SameSite, and origin-enforcement issues that blocked the embedded Clerk SDK in Electron.
- **Removed `@clerk/react` dependency** — Clerk SDK no longer loads in the renderer. Auth state is managed via a pure React context (`lib/auth.jsx`) backed by IPC + localStorage.
- **Simplified CSP** — Removed `clerk.mnemori.app` and `api.clerk.com` from renderer CSP since Clerk JS no longer loads in-app. Retained `img.clerk.com` for user avatars.
- **Reverted `webSecurity`** — Set back to `true` (was temporarily `false` during Clerk SDK debugging).
- **Removed Clerk request interceptors** — All `onBeforeSendHeaders`/`onHeadersReceived` hooks for Origin and cookie rewriting have been removed.

### Added
- **Clerk authentication** — Optional sign-in via Clerk (Email or Google). Unauthenticated users default to Owner role with full local control. Authenticated users inherit their organization role (Owner/Admin/Member) from Clerk.
- **Browser-based auth flow** — New `auth:sign-in` / `auth:sign-out` IPC handlers in main process. Sign-in opens a modal BrowserWindow to `mnemori.app/auth.html`, polls for `window.__mnemoriUser`, and resolves with user data.
- **Website auth page** — New `auth.html` on the marketing site serves as the desktop app's sign-in endpoint. Loads Clerk JS on the real domain (no CORS issues), sets `window.__mnemoriUser` after sign-in.
- **Role-based settings** — Members in an organization see restricted API key fields. Owners and Admins retain full control.
- **Account UI** — User identity displayed in sidebar with avatar, name, org, and role. Sign in/out from sidebar or Settings.
- **Cached identity** — Auth state cached to localStorage for offline operation after initial sign-in.
- **Permissions module** — Centralized capability map (`lib/permissions.js`) defining what each role can do: Owner/Admin control API keys, retention, and audit log; Members can record and choose audio device.
- **IPC role enforcement** — Main process checks role before allowing writes to admin-only settings (API keys, retention) and blocks member access to full audit log. Defense in depth — UI and backend both enforce.

### Security
- CSP tightened: removed `clerk.mnemori.app` and `api.clerk.com` from script-src/connect-src/frame-src (no longer needed); retained `img.clerk.com` in img-src for avatars
- `clerkUserId` and `clerkUserRole` added to settings allowlist for identity/role caching in main process
- Admin-only settings (API keys, retention) blocked at IPC level for member role — audit-logged when attempted
- No Clerk secret keys in client code — browser-based flow uses publishable key on the website domain only
- Auth window runs with `contextIsolation: true` and `nodeIntegration: false`

---

## [0.1.0] — 2026-05-01

### Added
- **Encrypted credential storage** — API keys are now encrypted at rest using Electron `safeStorage` (DPAPI on Windows, Keychain on macOS). Existing plaintext keys auto-migrate on startup. (Annex A.8.24)
- **Audit logging** — All security-relevant actions are recorded to a local `audit_log` table: app start, recording start/stop, transcription, generation, settings changes, deletions, credential migrations. Viewable from Settings. (Annex A.8.15)
- **Secure file deletion** — Files are overwritten with zeros before unlinking on manual delete and retention purge. (Annex A.8.10)
- **Data retention policy** — Configurable auto-delete after N days, enforced on app startup. (Annex A.8.12)
- **Methodology generation mode** — New artifact type for architectural rationale and design decision documentation.
- **Project intelligence** — Projects accumulate transcripts into synthesized summaries via Claude. Recordings auto-rename with a succinct title after transcription.
- **Cross-platform support** — macOS (avfoundation) and Windows (gdigrab + dshow) recording. Bundled ffmpeg via ffmpeg-static.
- **Python dependency eliminated** — Whisper and Claude API calls run natively in Node.js via `openai` and `@anthropic-ai/sdk` packages.
- **CI/CD pipeline** — GitHub Actions workflow builds Windows installer + portable .exe and macOS .dmg on every push.
- **Markdown rendering** — Generated artifacts render as formatted Markdown instead of raw text.
- **Audio meter** — Real-time VU meter in Settings for microphone testing.
- **Brand identity** — Fraunces/DM Sans typography, ember accent, editorial voice throughout UI.

### Security
- API keys encrypted at rest (safeStorage)
- Audit trail for all data operations
- Secure deletion with zero-fill overwrite
- contextIsolation enabled, nodeIntegration disabled
- Media protocol handler with file path validation
- No credentials in source code or git history

- **Copy to clipboard** — Copy buttons on transcripts and each generated artifact. Copies raw Markdown for artifacts, plain text for transcripts.
- **Compliance documentation** — `compliance/IDENTITY_MODEL.md` (roles, visibility rules, auth flow, token architecture), `compliance/SHARED_RESPONSIBILITY.md` (Mnemori vs. customer security boundary, subprocessor list), `PRODUCT_PRINCIPLES.md` (7 load-bearing principles governing product decisions).

### Fixed (vulnerability scan 2026-05-01)
- **CRITICAL**: media:// protocol path traversal — handler now validates all paths against `recordingsDir`, rejects and logs attempts to read outside it
- **CRITICAL**: Unrestricted `shell.openPath`/`showItemInFolder` — now restricted to `userDataDir`/`recordingsDir`
- **HIGH**: Settings IPC accepted arbitrary keys — now uses allowlist (`audioDevice`, `openaiApiKey`, `anthropicApiKey`, `retentionDays`)
- **HIGH**: Decrypted API keys exposed to renderer — now returns masked values only (first 7 + last 4 chars); save only writes when user provides a new key
- **HIGH**: No Content Security Policy — added CSP meta tag restricting `script-src` to `'self'`
- **MEDIUM**: Markdown rendering could execute injected elements — added `disallowedElements` blocking script/iframe/object/embed
- **MEDIUM**: `audit:list` limit unconstrained — clamped to max 1000
- **LOW**: Non-sensitive settings values could leak to audit log if new keys added — now only logs values for explicitly safe keys
- Removed `bypassCSP: true` from media:// protocol privileges

### Architecture
- Electron 33 + React 18 + Vite 5
- SQLite via better-sqlite3 (recordings, artifacts, settings, projects, audit_log)
- IPC bridge via contextBridge/preload (no direct Node access from renderer)
- Single-process ffmpeg recording (video+audio MP4), WAV extracted post-recording
