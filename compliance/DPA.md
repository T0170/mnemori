# Data Processing Addendum (DPA)

**Parties:**
- **Controller:** The organization deploying Mnemori ("Customer")
- **Processor:** Third Feather Capital Inc, operating the Mnemori application ("Mnemori")

**Effective date:** Upon execution by both parties  
**Last updated:** 2026-05-05  
**Version:** 1.0 (Draft — subject to legal review)

---

## 1. Definitions

- **Personal Data:** Any information relating to an identified or identifiable natural person, as defined in GDPR Article 4(1).
- **Processing:** Any operation performed on Personal Data, as defined in GDPR Article 4(2).
- **Subprocessor:** A third party engaged by Mnemori that processes Personal Data on behalf of the Customer.

## 2. Scope and Nature of Processing

### 2.1 What Mnemori Processes

Mnemori is a local-first desktop application. The application itself runs entirely on the Customer's devices. No Mnemori-operated servers receive, store, or process Customer content (recordings, transcripts, artifacts).

Processing occurs in two limited contexts:

| Context | Data processed | Purpose | Duration |
|---------|---------------|---------|----------|
| Identity and authentication | Email, name, organizational role | User authentication and access control | Until account deletion or identity cache expiry (7 days) |
| API relay to subprocessors | Audio files (to OpenAI), transcript text and screenshots (to Anthropic) | Transcription and document generation | Transient — data is sent directly from the Customer's device to the subprocessor via API; Mnemori does not retain a copy |

### 2.2 What Mnemori Does Not Process

- Screen recordings (.mp4) never leave the Customer's device
- Transcripts, artifacts, coaching data, and audit logs remain on the Customer's device
- Mnemori does not aggregate, analyze, or profile Personal Data across Customers

## 3. Lawful Basis

Processing is conducted on the basis of the Customer's legitimate interest in providing productivity tools to its workforce, and the Customer's contractual relationship with its users. The Customer is responsible for establishing the appropriate lawful basis under GDPR Article 6 for any Personal Data captured in recordings.

## 4. Data Subject Rights

| Right | How Mnemori supports it |
|-------|------------------------|
| Access (Art. 15) | Identity data: provided via Clerk dashboard. Content data: stored locally on Customer devices — Customer fulfills directly. |
| Rectification (Art. 16) | Identity data: updated via Clerk. Content data: editable locally by the user. |
| Erasure (Art. 17) | Identity data: deleted via Clerk dashboard. Content data: deleted locally via Mnemori's secure delete function (zero-fill overwrite + unlink). |
| Portability (Art. 20) | Content data is stored in standard formats (.mp4, .wav, .txt, .json, .md) on the Customer's filesystem. |
| Restriction (Art. 18) | Customer can disable API features, preventing any data from leaving the device. |
| Objection (Art. 21) | Customer controls all processing — features are opt-in. |

## 5. Subprocessors

### 5.1 Current Subprocessors

| Subprocessor | Location | Purpose | Data received | DPA status |
|-------------|----------|---------|---------------|------------|
| OpenAI, Inc. | United States | Audio transcription (Whisper API) | Audio files (.wav) | Governed by OpenAI API Terms — API data is not used for model training |
| Anthropic, PBC | United States | Document generation (Claude API) | Transcript text, screenshots, artifact content (when decay detection is enabled) | Governed by Anthropic API Terms — API data is not used for model training |
| Clerk, Inc. | United States | Authentication and identity | Email, name, session data | SOC 2 Type II certified; Clerk DPA available |

### 5.2 Subprocessor Changes

Mnemori will provide Customer with 30 days' prior written notice before engaging a new subprocessor that processes Personal Data. Customer may object within that period. If the objection cannot be resolved, Customer may terminate the agreement.

### 5.3 Data Residency

Audio data sent to OpenAI and text sent to Anthropic are processed in the United States. For Customers subject to EU data protection requirements, this constitutes a cross-border transfer under GDPR Chapter V. The transfer mechanism is:

- **OpenAI:** Standard Contractual Clauses (SCCs) incorporated in OpenAI's DPA
- **Anthropic:** Standard Contractual Clauses (SCCs) incorporated in Anthropic's Terms of Service
- **Clerk:** Standard Contractual Clauses (SCCs) incorporated in Clerk's DPA

Customers requiring EU-only processing may disable cloud transcription and generation features, using Mnemori in local-only recording mode. Local Whisper transcription (fully on-device, no cross-border transfer) is on the product roadmap.

## 6. Security Measures

Mnemori implements the following technical and organizational measures:

| Measure | Implementation |
|---------|---------------|
| Encryption in transit | All API communication via HTTPS/TLS 1.2+ |
| Credential encryption | API keys encrypted via OS secure storage (DPAPI/Keychain) |
| Secure deletion | Zero-fill overwrite before file unlink |
| Access control | Role-based permissions (Owner/Admin/Member) enforced at UI and IPC layers |
| Audit logging | Cryptographically chained, append-only local audit log |
| Process isolation | Electron contextIsolation, sandbox, no nodeIntegration |
| Content Security Policy | Script-src restricted to 'self' in production builds |
| Data minimization | Only data necessary for the requested operation is sent to subprocessors |
| Consent controls | Cloud features (decay detection, coaching extraction) require explicit opt-in |

See `SECURITY.md` for the complete security posture documentation.

## 7. Data Breach Notification

In the event of a Personal Data breach:

1. Mnemori will notify Customer without undue delay and within 72 hours of becoming aware of the breach (GDPR Art. 33)
2. Notification will include: nature of the breach, categories and approximate number of data subjects affected, likely consequences, measures taken or proposed
3. Mnemori will cooperate with Customer's own notification obligations to supervisory authorities and data subjects

See `INCIDENT_RESPONSE.md` for the detailed incident response procedure.

## 8. Data Retention and Deletion

- **Identity data:** Retained for the duration of the Customer's use of Mnemori. Deleted upon request via Clerk dashboard.
- **Content data:** Retained on Customer's devices according to the Customer's configured retention policy. Auto-deletion enforced on each application startup. Secure deletion (zero-fill overwrite) used for all file removals.
- **Subprocessor retention:** Per OpenAI and Anthropic API terms, API data is not retained for model training. Standard API log retention applies per each subprocessor's privacy policy.

Upon termination of the agreement, Mnemori will delete all Customer identity data within 30 days. Content data is already under Customer's sole control and requires no action from Mnemori.

## 9. Audit Rights

Customer may audit Mnemori's compliance with this DPA:

- Mnemori will provide completed security questionnaire responses upon request
- Mnemori will make available the results of third-party security assessments (penetration tests, SOC 2 reports) under NDA
- Mnemori's application source code, SECURITY.md, and compliance documentation are available for Customer review
- On-site audits may be conducted with 30 days' notice, no more than once annually, during business hours, subject to reasonable confidentiality protections

## 10. Term and Termination

This DPA is effective for the duration of Mnemori's processing of Customer Personal Data. It survives termination of the underlying agreement to the extent Mnemori retains any Customer Personal Data.

## 11. Governing Law

This DPA is governed by the laws of the jurisdiction specified in the underlying agreement. For GDPR-related provisions, EU data protection law takes precedence to the extent of any conflict.

---

*This document is a draft template. Customers should review it with their own legal counsel before execution. Mnemori recommends that Customers also review the DPAs of the subprocessors listed in Section 5.1.*

## Revision History

| Date | Version | Change |
|------|---------|--------|
| 2026-05-05 | 1.0 | Initial draft |
