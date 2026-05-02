# Identity Model

This document defines how Mnemori handles identity, authorization, and organizational boundaries. It is the source of truth for both the engineering implementation and security questionnaire responses.

**Implementation status (v0.2.0):** Clerk authentication is implemented in the desktop app and marketing site. Role-based permissions (Owner/Admin/Member) are enforced at both the UI and IPC layers. Organization features (invite, roster, shared visibility) require the cloud admin service, which is not yet built. Unauthenticated users operate as self-sovereign Owners with full local control.

Last updated: 2026-05-01

---

## Governing principle

Login data is the only thing that flows without direct user action.

Mnemori's cloud service answers one question: *who is this person, and what can they do?* Every other action — recording, transcription, generation, export — originates from a deliberate user choice inside the desktop application. The cloud service does not see recordings, transcripts, or artifacts. It sees identity events.

This principle bounds the cloud service's scope, the certification surface, and the trust a customer extends to Mnemori.

---

## Entities

### Organization

An organization represents a single customer — a company, a team, a consulting firm. It is the tenancy boundary. All configuration, permissions, and audit visibility are scoped to the organization.

An organization has:
- A unique identifier
- A display name
- A billing relationship (one org, one subscription)
- Configuration: retention policy, allowed integrations, security settings
- A roster of users with assigned roles

Organizations are isolated from each other. No user in one organization can see, access, or infer the existence of another organization's data, configuration, or membership.

### User

A user is a person who uses Mnemori. A user belongs to exactly one organization at a time. (Multi-org membership may be supported in a future version; the data model should not preclude it, but the v1 implementation assumes single-org.)

A user has:
- An email address (the primary identifier, verified at sign-up)
- A display name
- A role within their organization
- A local identity cache on each device where they are signed in

### Device

A device is a desktop installation of Mnemori. A user may be signed in on multiple devices. Each device holds:
- A cached identity token (for offline operation)
- All recordings, transcripts, and artifacts created on that device
- Integration tokens for any configured external services

Devices are not first-class entities in the identity model — the system does not enumerate or manage devices centrally. A user's devices are implicitly the set of machines where their identity token is cached.

---

## Roles

Three roles, in descending order of privilege:

### Owner

The person who created the organization or received ownership transfer. There is exactly one Owner per organization at any time.

**Can do everything an Admin can do, plus:**
- Transfer ownership to another Admin
- Delete the organization (irreversible, requires confirmation)
- Manage billing and subscription

**Rationale:** The Owner/Admin distinction prevents an administrator who leaves the organization from holding the org hostage. Ownership is a singular, transferable responsibility.

### Admin

A user with organizational management privileges. An organization may have multiple Admins.

**Can:**
- Invite and remove users
- Assign and change user roles (except Owner)
- Configure organization settings: retention policy, allowed integrations, security preferences
- View the organization-wide audit log
- View all recordings, transcripts, and artifacts created by any member of the organization

**Cannot:**
- Delete the organization
- Transfer ownership
- Manage billing (unless also the Owner)

### Member

A standard user. This is the default role for newly invited users.

**Can:**
- Create recordings, transcriptions, and generated artifacts
- View, edit, and delete their own work
- Use integrations the Admin has enabled
- View their own audit history

**Cannot:**
- See other members' recordings or artifacts
- View the organization-wide audit log
- Change organization settings
- Invite or remove users

### Future: Viewer (not in v1)

A user who can be granted read-only access to specific recordings shared with them. Useful for senior stakeholders reviewing work without a full member seat. Will be added when a customer concretely requests it.

---

## Visibility rules

The asymmetry is deliberate and maps to organizational accountability:

| Data | Owner | Admin | Member |
|------|-------|-------|--------|
| Own recordings and artifacts | Full access | Full access | Full access |
| Other members' recordings and artifacts | Full access | Full access | **None** |
| Organization settings | Full access | Full access | Read-only (retention policy visible) |
| Audit log (organization-wide) | Full access | Full access | **None** |
| Audit log (own actions) | Full access | Full access | Full access |
| User roster | Full access | Full access | Roster visible, roles visible |
| Billing | Full access | **None** | **None** |

**Why this asymmetry exists:** The Admin is the customer's accountable representative — the person who signs the data processing agreement, configures retention, and explains data handling to their compliance officer. Admins need visibility into what the organization is doing with the tool. Members are accountable to their Admin, not to Mnemori. Giving Members visibility upward would invert the responsibility chain.

---

## Authentication flow

### Desktop app (primary)

1. User launches Mnemori for the first time (or after signing out)
2. User clicks "Sign in" in the sidebar or Settings page
3. The main process opens a modal BrowserWindow to `https://mnemori.app/auth.html`
   - Clerk JS loads on the real domain — no CORS issues, no cookie workarounds
   - If the email's domain is configured for enterprise SSO (SAML/OIDC), Clerk redirects to the customer's identity provider
   - Otherwise, Clerk handles email verification or password authentication
4. On success, the auth page sets `window.__mnemoriUser` with the user's identity data (id, email, name, imageUrl, role, orgId, orgName)
5. The main process polls `window.__mnemoriUser` via `executeJavaScript` every 500ms
6. Once identity data is captured, the auth window closes automatically
7. The main process stores `clerkUserId` and `clerkUserRole` in the settings table
8. The renderer caches the full identity context in localStorage for offline operation

**Why browser-based auth:** Clerk's production SDK enforces Origin domain matching — it rejects requests from `localhost` or Electron's renderer origin. Rather than spoofing Origins and rewriting cookies (approaches that proved fragile), the auth window runs on `mnemori.app` where Clerk works natively. This follows the same pattern used by VS Code, Slack, and Figma for desktop authentication.

**Offline operation:** Once authenticated, the app works fully offline using cached identity context (localStorage in the renderer, settings table in SQLite). The identity cache persists across sessions. Sign-out clears both stores.

### Admin web app (planned)

A separate web application for organizational administration. Will use Clerk's web SDK for authentication — the same identity, different surface. Admins will manage users, configure settings, and review audit logs here. Not yet built.

---

## Token architecture

Two distinct token types exist in the system. Conflating them is a security error.

### Identity cache

- **Source:** Clerk, after successful authentication via the browser-based auth window
- **Contains:** user id, email, name, avatar URL, role, org id, org name
- **Lifetime:** persists until explicit sign-out. No session token is stored locally — Clerk manages sessions on `mnemori.app` only
- **Storage:** localStorage in the renderer (`mnemori:identity`), userId and role in SQLite settings table
- **Scope:** local authorization decisions only — never sent to third parties

### Integration token

- **Issued by:** the destination platform (Google, Notion, Airtable, etc.) via their OAuth flow
- **Proves:** Mnemori has permission to act on the user's behalf with that platform
- **Lifetime:** varies by platform (typically long-lived refresh tokens)
- **Storage:** on the user's device in v1 (preserves local-first principle); encrypted cloud storage in a future version if server-to-server integrations require it
- **Scope:** as narrow as the platform allows (e.g., write access to a single Google Drive folder, not all of Drive)

Integration tokens are configured by Admins (who enable which integrations are available) and authorized by individual users (who complete the OAuth flow with the destination platform).

---

## Deprovisioning

When a user is removed from an organization:
- Their identity token is revoked
- Their cached identity context on all devices becomes invalid on next refresh attempt
- Their recordings, transcripts, and artifacts remain on their local devices (Mnemori does not have the ability to remotely wipe local files)
- Their cloud audit log entries are retained (they are organizational records, not personal data)
- Integration tokens on their devices become orphaned — the Admin should revoke access from the destination platform's console

**Open question:** Should Mnemori signal the desktop app to clear local data on deprovisioning? This is technically possible (the app checks identity on refresh) but has implications for data the user may consider their own. This is a policy decision, not a technical one, and should be configurable per-organization.

---

## What the cloud service stores

| Data | Stored in cloud | Encrypted | Retention |
|------|----------------|-----------|-----------|
| User identity (email, name, role) | Yes | At rest (platform encryption) | Until user is removed + 90 days |
| Organization configuration | Yes | At rest | Until org is deleted |
| Audit log entries | Yes | At rest | Configurable per-org, minimum 1 year |
| Session tokens | Yes (Clerk-managed) | Yes | Short-lived, auto-expire |
| Integration tokens | **No** (device-only in v1) | N/A | N/A |
| Recordings, transcripts, artifacts | **No** | N/A | N/A |

---

## What the cloud service does not store

- Recordings (video or audio)
- Transcripts
- Generated artifacts (SOPs, methodology docs, coaching reviews, notes)
- File paths or filesystem metadata from user devices
- Integration tokens (in v1)
- Any content derived from the user's work

This is structural, not a policy choice. The cloud service has no API endpoint that accepts content. It cannot receive recordings or transcripts even if someone tried to send them.
