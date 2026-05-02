# Mnemori

> *Spoken memory.*

**Pronounced** `neh-MOR-ee` *(silent M, stress on the second syllable, ends like "memory")*

An Electron + React desktop app for capturing narrated screen recordings and turning them into documentation, coaching reviews, and cleaned notes. You talk while you work; Mnemori remembers, transcribes, and refines.

The name is derived from the Greek root *mnemo-* (memory) with a Latin vocative-style ending, suggesting "what is remembered through speaking." It pairs the act of voicing your reasoning with the durable artifact that voice becomes.

---

## What's in here

```
mnemori/
├── package.json              electron + vite + react deps
├── vite.config.js            renderer build config
├── src/
│   ├── main/
│   │   ├── index.js          electron main process — recording, db, IPC, API calls
│   │   └── preload.js        secure bridge to the renderer
│   └── renderer/             react UI
│       ├── index.html
│       ├── main.jsx
│       ├── App.jsx
│       ├── styles.css        full design system
│       ├── components/       Sidebar, RecordingControl
│       ├── pages/            Library, RecordingDetail, Settings, Concepts, Projects
│       └── lib/              auth, permissions, toast, formatters
├── compliance/               IDENTITY_MODEL.md, SHARED_RESPONSIBILITY.md
├── CHANGELOG.md
├── SECURITY.md
└── BRAND.md
```

The Electron main process owns recording (spawns ffmpeg), the local SQLite database, and calls OpenAI Whisper and Anthropic Claude APIs directly via their Node.js SDKs. The renderer is a React app that talks to it through a typed IPC bridge in `preload.js`.

---

## First-run setup

### 1. Prerequisites
- **Node.js 18+** — https://nodejs.org/
- **ffmpeg** — `winget install ffmpeg` then restart your terminal

### 2. Install dependencies
```powershell
cd mnemori
npm install
```

`better-sqlite3` may need to rebuild against Electron's Node version. If you see errors:
```powershell
npx electron-rebuild
```

### 3. Run in development
```powershell
npm run dev
```
This starts Vite (the React dev server) and Electron together. The app window opens in a few seconds.

### 4. Configure on first launch
Open **Settings** in the sidebar:
- Click **Re-scan devices** to populate the microphone list, then pick yours
- Paste your **OpenAI** key (for Whisper transcription) and **Anthropic** key (for Claude documentation)
- Hit **Save**

You're ready. Press **Start Recording** in the sidebar, narrate what you're doing, then **Stop**. The recording lands in the Library. Click into it, hit **Transcribe audio**, then generate any combination of SOP / Coaching / Methodology / Notes.

---

## Brand notes

When writing about Mnemori — in marketing, documentation, anywhere the name appears in prose — a few rules keep the brand consistent:

- The name is always capitalized as **Mnemori** (not MNEMORI, not mnemori, except in code identifiers and URLs)
- Pronunciation is **neh-MOR-ee** — worth including a pronunciation guide on the website and at the start of any video, because the silent M will trip up most readers
- The tagline is **"Spoken memory."** — short, definite, period included
- The primary visual identity uses **Fraunces** (serif, for the wordmark) and **DM Sans** (for UI), with a single ember accent color (`#c4441a`) on a warm cream background (`#f3ede1`)
- The product is referred to as "Mnemori," not "the Mnemori app." It's a noun, like Notion or Linear, not a tool you wield

### Voice and tone

Mnemori is editorial, considered, slightly literary. It's not chirpy or salesy. Empty states say "Nothing remembered yet," not "No recordings — get started!" Buttons say "Start Recording," not "START NOW!". The product respects the user's attention and intelligence.

When in doubt: how would a quiet, confident craft tool talk?

---

## How the pieces fit together

```
Renderer (React)  <--IPC (preload.js)-->  Main (Electron)
  UI, no OS access                          SQLite, ffmpeg, OpenAI SDK, Anthropic SDK
```

The renderer never touches the file system or shells out directly — that's the security model Electron is built around. Every action goes through `window.api.*` (defined in `preload.js`), which forwards to handlers in `src/main/index.js`.

---

## What works (v0.2.0)

- Recording from a sidebar control (start/stop, live timer)
- Local SQLite library with status tracking (recorded > transcribing > ready)
- Per-recording detail view: video player, transcript, generated artifacts
- Four generation modes: SOP, Coaching review, Methodology, Cleaned notes
- Project tagging and free-form tags on each recording
- Markdown rendering for generated artifacts
- Copy to clipboard for transcripts and artifacts
- Settings: mic selection (auto-detected via ffmpeg), encrypted API key storage
- Click-to-show-in-folder, delete with confirmation
- Optional Clerk authentication with role-based permissions (Owner/Admin/Member)
- Browser-based sign-in flow (opens mnemori.app/auth.html in a modal window)
- Audit logging for security-relevant actions
- Secure file deletion with zero-fill overwrite
- Configurable data retention with auto-delete
- CI/CD pipeline (GitHub Actions builds Windows installer + macOS .dmg)
- Editorial design system, Fraunces typography, real polish

---

## Roadmap

**Near-term**
1. **Global hotkey for record start/stop** — works even when the app is in the background. `globalShortcut` in main, plus a tiny floating overlay window showing the timer
2. **Synced transcript playback** — clicking a transcript segment seeks the video; the active segment highlights as the video plays
3. **Export artifact to file** — save as .md via `dialog.showSaveDialog` (clipboard copy already works)
4. **Re-run generation with a custom prompt** — modal where you can tweak the prompt before regenerating

**Mid-term**
5. **Concepts page** — run a Claude pass over each transcript that extracts mentioned concepts/techniques as JSON, store in a `concepts` table, link back to the moments they appear
6. **Projects page** — group recordings, see all artifacts in one place, export bundle
7. **Search** — full-text across transcripts and artifacts (SQLite FTS5 is built in)
8. **Auto-pipeline option** — toggle "auto-transcribe and auto-generate SOP after recording stops"
9. **Airtable export** — push recordings + artifacts to a base

**Long-term (SaaS-ready)**
10. **Auto-update** — `electron-updater` so beta users get fixes without reinstalling
11. **Code signing** — a Windows installer that doesn't trigger SmartScreen
12. **Optional cloud backup** — encrypted sync of metadata + artifacts (not video). Opt-in
13. **Team workspace** — multiple users, shared concept libraries, review queues. The SaaS pivot point

---

## Notes on architecting for SaaS later

A few choices in this codebase are deliberate to make a future web/SaaS version cheaper:

- **All UI is web tech** (React + plain CSS). Drops into a Next.js app unchanged
- **The renderer never assumes Electron** — it only talks to `window.api`. Swap that for a `fetch('/api/...')` layer in a web build and the same components work
- **Database access is centralized** in main process handlers. Translates 1:1 to API endpoints
- **API calls are in the main process** — OpenAI and Anthropic SDKs are called from Node.js. Move them behind an API gateway for multi-tenant usage

If Mnemori grows into a real product, the path is: keep the desktop app for power users (capture has to be local), add a web companion for review and sharing, build the team layer there. Don't try to make the desktop app multi-tenant.

---

## Troubleshooting

**`better-sqlite3` build errors during `npm install`** — install Visual Studio Build Tools (C++ workload), then run `npx electron-rebuild`.

**Recording starts but file is empty** — antivirus is blocking ffmpeg or the mic name is wrong. Check Settings > re-scan devices.

**Whisper API errors on long recordings** — Whisper has a 25 MB upload limit. The 16kHz mono WAV the app produces holds about 90 minutes. For longer sessions, split with ffmpeg first.

**Hot reload not working in dev** — Vite reloads the renderer fine, but changes to `src/main/*` require restarting `npm run dev`.

---

## Building a real distributable

```powershell
npm run build
```

Outputs an installable `.exe` in `dist/`. For beta users, that's enough. For wider distribution you'll want code signing.

---

## Trademark and legal notes (informal)

The name **Mnemori** was chosen partly because it appeared to have no obvious conflicts in software at the time of selection. Before any commercial launch:

1. Run a formal USPTO search at `trademarkcenter.uspto.gov` for class 9 (computer software) and class 42 (software-as-a-service)
2. Ideally have a trademark attorney do a clearance search ($300-1,500 — worth it before public launch)
3. Secure `mnemori.com` if available; fall back to `mnemori.app` or `getmnemori.com` if not
4. Register the trademark once you've validated the product has traction (don't pay for registration on day one)
