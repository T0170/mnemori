# Shared Responsibility Model

This document defines the division of security responsibility between Mnemori and its customers. It applies to the desktop application and the identity service together.

Last updated: 2026-05-01

---

## Overview

Mnemori is a local-first application. The security model reflects this: Mnemori is responsible for the software, the identity service, and the subprocessor relationships. The customer is responsible for their devices, their users, and their organizational policies.

The boundary is clean because Mnemori does not hold customer content. Recordings, transcripts, and artifacts live on the customer's devices. Mnemori's cloud service handles identity and organizational configuration only.

---

## Mnemori's responsibilities

### Application security
- Maintaining the security of the desktop application code
- Patching known vulnerabilities in application dependencies
- Enforcing process isolation (contextIsolation, no nodeIntegration)
- Encrypting credentials at rest using OS-level secure storage
- Secure deletion of files when users or retention policies remove recordings
- Content Security Policy enforcement in the renderer
- Input validation on all IPC channels between renderer and main process

### Identity service
- Operating a secure authentication service (delegated to Clerk)
- Enforcing role-based access control as defined in the Identity Model
- Issuing and revoking identity tokens
- Maintaining the integrity of the organization-wide audit log
- Encrypting all identity data at rest and in transit

### Subprocessor management
- Selecting subprocessors that maintain SOC 2, ISO 27001, or equivalent certifications
- Maintaining a current subprocessor list and notifying customers of changes
- Ensuring data processing agreements are in place with each subprocessor
- Monitoring subprocessor security posture on an ongoing basis

### Incident response
- Maintaining an incident response plan for security events affecting the identity service
- Notifying affected customers within 72 hours of a confirmed data breach (per GDPR Article 33)
- Providing post-incident analysis and remediation

---

## Customer's responsibilities

### Device security
- Maintaining operating system updates and security patches on devices running Mnemori
- Enabling full-disk encryption (BitLocker on Windows, FileVault on macOS) — Mnemori encrypts credentials but not recording files; disk encryption covers the gap
- Controlling physical access to devices that contain recordings
- Managing endpoint protection (antivirus, EDR) on devices running Mnemori

### User management
- Provisioning and deprovisioning users in a timely manner
- Assigning appropriate roles (Owner, Admin, Member) to users
- Revoking access when employees leave the organization
- Configuring enterprise SSO if required by organizational policy
- Training users on acceptable use of recording and transcription features

### API key management
- Providing and managing their own OpenAI and Anthropic API keys
- Rotating keys on a schedule consistent with their security policy
- Understanding that audio data is sent to OpenAI and transcript text is sent to Anthropic when users initiate transcription and generation (Mnemori does not control subprocessor data handling beyond what the subprocessor's API terms provide)

### Organizational policy
- Configuring the data retention policy appropriate to their compliance requirements
- Deciding which integrations to enable for their organization
- Establishing and communicating internal policies about what may be recorded (screen recordings may capture sensitive content visible on screen)
- Complying with local laws regarding recording consent — in many jurisdictions, recording calls or meetings requires consent of all parties

### Data governance
- Understanding that recordings and transcripts are stored locally on user devices, not in Mnemori's cloud
- Implementing backup and recovery procedures for local data if business continuity requires it
- Managing data subject access requests (DSARs) for any personal data captured in recordings — Mnemori can assist by identifying which recordings exist, but the customer controls the data

---

## Shared responsibilities

### Authentication security
- **Mnemori** provides the authentication infrastructure (via Clerk) and enforces token lifecycle
- **Customer** ensures users follow authentication best practices (strong passwords, MFA enrollment if required by org policy)
- **Both** cooperate on investigating unauthorized access — Mnemori provides audit log data, customer provides context about the affected user

### Integration security
- **Mnemori** implements OAuth flows with destination platforms using least-privilege scoping
- **Customer** authorizes which integrations are available to their organization and reviews integration permissions
- **Both** are responsible for revoking integration tokens when access is no longer needed — Mnemori revokes on its side during deprovisioning, customer revokes on the destination platform's side

### Compliance
- **Mnemori** maintains its own ISO 27001 certification (in progress) and provides compliance documentation
- **Customer** determines which compliance frameworks apply to their use of Mnemori and configures the product accordingly
- **Both** cooperate during audits — Mnemori provides a SOC 2/ISO 27001 report and security questionnaire responses, customer maps these to their own compliance requirements

---

## Subprocessor list

| Subprocessor | Purpose | Data received | Compliance |
|-------------|---------|--------------|------------|
| Clerk | Authentication and identity management | Email, name, session data | SOC 2 Type II |
| OpenAI | Audio transcription (Whisper API) | Audio files (.wav), sent when user initiates | SOC 2 Type II |
| Anthropic | Document generation (Claude API) | Transcript text, sent when user initiates | SOC 2 Type II |
| Cloud provider (TBD) | Identity service hosting, audit log storage | Organization config, audit entries | SOC 2, ISO 27001 |

Mnemori will provide 30 days' notice before adding a new subprocessor that handles customer data.

---

## What this model means in practice

A customer evaluating Mnemori for enterprise use should understand:

1. **Mnemori never has your recordings or documents.** They live on your team's devices. Our cloud service knows who your users are and what they're allowed to do. That's the entire scope.

2. **Your API keys, your subprocessor relationship.** When your team transcribes audio, that audio goes directly from their device to OpenAI. When they generate documents, the transcript goes directly to Anthropic. Mnemori facilitates this — we don't proxy, store, or inspect the content.

3. **Your devices, your responsibility.** We encrypt credentials and securely delete files, but we can't protect a laptop left unlocked in a coffee shop. Disk encryption is the single most impactful security measure your organization can take.

4. **Deprovisioning is a shared action.** When you remove a user, we revoke their identity immediately. But their local files remain on their device until the device is wiped or the retention policy runs. Plan for this in your offboarding process.
