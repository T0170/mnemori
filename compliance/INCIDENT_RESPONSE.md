# Incident Response Plan

**Owner:** Third Feather Capital Inc  
**Last updated:** 2026-05-05  
**Version:** 1.0

---

## 1. Scope

This plan covers security incidents affecting Mnemori — the desktop application, its build/release pipeline, and the third-party APIs it communicates with (OpenAI, Anthropic, Clerk). It applies to all contributors and maintainers.

## 2. Roles and Responsibilities

| Role | Person | Responsibilities |
|------|--------|------------------|
| Incident Commander | Project Owner (Taylor Allen) | Declares severity, coordinates response, approves communications |
| Technical Lead | Project Owner | Investigates root cause, develops fix, deploys patch |
| Communications | Project Owner | Drafts user notifications, updates status page/GitHub |

As the team grows, these roles will be separated. Until then, the project owner holds all three.

## 3. Severity Classification

| Level | Definition | Response SLA | Examples |
|-------|-----------|-------------|----------|
| P1 — Critical | Active exploitation, data breach, or credential compromise | Begin response within 1 hour | API keys leaked in release, RCE in Electron runtime, supply chain compromise |
| P2 — High | Exploitable vulnerability with no evidence of active exploitation | Begin response within 4 hours | Known CVE in shipping dependency, authentication bypass, path traversal |
| P3 — Medium | Vulnerability requiring specific conditions to exploit | Begin response within 24 hours | Information disclosure under unusual conditions, privilege escalation requiring local access |
| P4 — Low | Theoretical risk or defense-in-depth improvement | Address in next release cycle | Missing hardening header, informational finding from pentest |

## 4. Detection Sources

- **User reports:** Direct contact via security reporting channel (see SECURITY.md)
- **Dependency monitoring:** `npm audit` in CI pipeline, GitHub Dependabot alerts
- **CVE feeds:** Electron releases, OpenAI/Anthropic security advisories
- **Audit log review:** Anomalous entries (e.g., `security:blocked` events, integrity mismatches)
- **Penetration testing:** Findings from periodic third-party assessments

## 5. Response Procedure

### 5.1 Detection and Triage

1. Log the incident: date, source, initial description
2. Classify severity (P1-P4) based on the table above
3. If P1 or P2: begin response immediately, defer non-critical work

### 5.2 Containment

| Scenario | Containment Action |
|----------|-------------------|
| Compromised API key (OpenAI/Anthropic) | Rotate key immediately via provider console. Push notification to affected users to update their keys. |
| Compromised release binary | Remove the GitHub release. Post advisory. Push emergency update with clean binary. |
| Vulnerable dependency (shipping) | Assess exploitability in Mnemori's context. If exploitable: emergency patch. If mitigated by architecture: patch in next release with advisory. |
| Data exposure (recording/transcript leak) | Identify the vector. If via the application: fix and release. If via user's machine: advise secure deletion and credential rotation. |
| Build pipeline compromise | Revoke CI tokens. Audit recent releases. Re-build from verified source. |

### 5.3 Eradication

1. Identify root cause (code review, git bisect, dependency audit)
2. Develop and test fix on isolated branch
3. Verify fix does not introduce regression

### 5.4 Recovery

1. Release patched version via auto-updater
2. For P1/P2: tag release as security update in release notes
3. Verify fix deployed by monitoring update adoption (GitHub release download counts)

### 5.5 Communication

| Audience | Channel | Timeline |
|----------|---------|----------|
| Affected users | GitHub Security Advisory + email if available | Within 72 hours of confirmed incident (GDPR Art. 33/34) |
| All users | GitHub release notes, changelog | With the patch release |
| Subprocessors (OpenAI, Anthropic) | Direct contact if their service is involved | As soon as practicable |
| Regulatory authorities | If personal data breach affects EU data subjects | Within 72 hours (GDPR Art. 33) |

**Communication template:**

> **Security Advisory — [Title]**
>
> **Severity:** P[X]  
> **Affected versions:** [versions]  
> **Fixed in:** [version]  
>
> **What happened:** [brief description]  
> **Impact:** [what data/functionality was affected]  
> **What we did:** [containment and fix]  
> **What you should do:** [update, rotate keys, etc.]

### 5.6 Post-Mortem

Within 5 business days of resolution:

1. Timeline of events (detection through resolution)
2. Root cause analysis
3. What worked well in the response
4. What could be improved
5. Action items with owners and deadlines
6. Update this plan if process gaps were identified

Post-mortem is blameless. The goal is systemic improvement.

## 6. Plan Maintenance

- Review this plan quarterly or after any P1/P2 incident
- Test the response process annually (tabletop exercise)
- Update contact information when team membership changes
- Log all plan revisions in the revision history below

## 7. Revision History

| Date | Version | Change |
|------|---------|--------|
| 2026-05-05 | 1.0 | Initial version |
