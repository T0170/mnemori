# Product Principles

These principles govern how Mnemori is built. They are load-bearing — meaning features, architecture decisions, and vendor choices should be tested against them. When a proposed change conflicts with a principle, the principle wins unless the team explicitly decides to revise it.

Last updated: 2026-05-01

---

## 1. Voice is the differentiator, not workflow

Mnemori captures what the user was *thinking*, not what they clicked. The product records narrated reasoning and turns it into documentation, coaching, and institutional knowledge. Competitors like Scribe capture clicks and infer actions. Mnemori captures speech and preserves intent.

**Implication:** Do not build click-tracking, browser extensions, screenshot-based step generators, or workflow inference. These are solved problems in someone else's category. Build features that lean into voice-first capture and reasoning extraction.

---

## 2. Login data is the only thing that flows without user action

Mnemori's cloud service answers one question: *who is this person, and what can they do?*

Every other action — recording, transcription, generation, export — originates from a deliberate user choice inside the desktop application. The cloud service does not see recordings, transcripts, or artifacts. It sees identity events.

**Implication:** No background sync of content. No telemetry about what the user records or generates. No "anonymous usage data to improve the product." The cloud's scope is identity and organizational configuration. When someone asks what Mnemori knows about their work, the answer is *nothing*.

This principle bounds the certification surface, the legal exposure, and the trust a customer extends to Mnemori. Do not dilute it.

---

## 3. Mnemori facilitates; compliant subprocessors do the work

OpenAI handles transcription. Anthropic handles generation. Clerk handles authentication. The cloud provider handles infrastructure. Each of these vendors maintains SOC 2, ISO 27001, or equivalent certifications.

Mnemori's job is to connect the user's intent to the right subprocessor securely and transparently. By choosing compliant vendors for every component we don't build ourselves, we inherit their compliance posture for the parts of the system they handle.

**Implication:** Vendor selection is a compliance decision, not just a technical one. When evaluating a new integration or subprocessor, "do they have SOC 2 / ISO 27001?" is a real screening criterion. Some otherwise-attractive smaller vendors will fail this test. Let them fail rather than absorbing their compliance gap into our own risk profile.

---

## 4. The product respects the user's attention and intelligence

Mnemori is editorial, considered, slightly literary. It is not chirpy or salesy. Empty states say "Nothing remembered yet," not "No recordings — get started!" Buttons say "Start Recording," not "START NOW!" The product respects the user's time and does not compete for their attention.

**Implication:** No emoji in UI strings. No exclamation marks in calls to action. No gamification, streaks, or engagement metrics. No notification badges that create anxiety. When in doubt, ask: how would a quiet, confident craft tool talk?

---

## 5. Local-first, cloud-optional

Recordings, transcripts, and artifacts live on the user's device. The desktop application works fully offline once authenticated. The cloud service is required only for identity (who you are) and organizational policy (what you're allowed to do). Everything else runs locally.

**Implication:** Never design a feature that requires the cloud to be available for the user to do their core work (record, transcribe, generate, review). The cloud enhances — it does not gate. If connectivity drops mid-session, the user should not notice until they try to do something that structurally requires the network (like signing in from a new device).

---

## 6. Reduce liability to the structural minimum

Mnemori's security claim is architectural, not promised. The system is designed so that customer data never leaves their control — not because we promise to be careful with it, but because we never have it in the first place.

**Implication:** "We don't hold your data" is true but reads as deflection. "Mnemori is designed so that your data never leaves your control" is the same fact, framed as a feature. The security story is the product story. When an enterprise buyer asks "what happens if Mnemori gets breached?", the answer is: they get email addresses and org names. Not recordings. Not transcripts. Not the reasoning your team narrated while building their most sensitive projects.

---

## 7. Build for the audit before the auditor arrives

Operate as if ISO 27001 certification is happening in six months, even when it isn't. Document policies as they're created, not retroactively. Log security-relevant actions from day one. Choose compliant vendors from the start. Maintain a risk register.

**Implication:** Every code change that touches security gets a SECURITY.md update. Every notable change gets a CHANGELOG.md entry. Compliance documentation lives in `compliance/` and is maintained alongside the code, not produced in a scramble before an audit. When the auditor does arrive, the preparation is: formalizing what we already do, not transforming the company into something it isn't.
