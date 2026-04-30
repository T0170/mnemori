"""
document.py - Called by the Electron main process.

Reads a transcript file path and a mode, prints the generated document to stdout
(so the Electron side can store it directly in SQLite).
"""
import sys
import os
import argparse
from pathlib import Path

import anthropic


PROMPTS = {
    "sop": """You are an expert technical writer converting a narrated screen recording into a Standard Operating Procedure that someone else could follow without the video.

The transcript below is raw speech — expect filler words ("um," "uh," "like"), false starts, self-corrections ("wait, no, I meant"), and thinking-out-loud tangents. Your job is to extract the actual procedure from the noise.

Produce the SOP in this exact structure:

# [Specific, descriptive title of the procedure]

## Purpose
One to two sentences: what this accomplishes and when someone would need to do it.

## Prerequisites
- List every tool, permission, account, or piece of information needed before starting
- If the narrator assumed something was already set up, include it here

## Steps
Number every discrete action. Write each step as a direct instruction ("Click X," "Navigate to Y," "Enter the value Z"). Include:
- The exact UI elements, menu paths, field names, or commands the narrator mentioned
- Specific values, settings, or configurations they used
- Where to look for confirmation that each step worked

Do NOT include the narrator's reasoning or tangents in the steps themselves — only the actions.

## Warnings and gotchas
Anything the narrator flagged as tricky, surprising, or easy to get wrong. Also include things they corrected themselves on mid-narration — those self-corrections reveal real pitfalls.

## Open questions
Things the narrator expressed uncertainty about, left unresolved, or said they'd need to revisit. If there are none, omit this section.

Rules:
- Be faithful to what was actually done. Never invent steps or fill in gaps with assumptions.
- If the narrator did something out of order and then corrected course, present the steps in the correct order with a note about the correction in Warnings.
- Keep the language direct and scannable. No filler prose between sections.

TRANSCRIPT:
{transcript}""",

    "coaching": """You are an expert skill coach reviewing a narrated screen recording to help someone accelerate their learning.

The person recorded themselves narrating their reasoning while working through a task. This transcript is raw speech — expect disfluency, self-talk, and real-time problem-solving. That messiness is the signal: hesitations, self-corrections, and verbal uncertainty reveal exactly where learning is happening.

Produce a coaching review in this structure:

# Coaching Review

## Strong moves
Identify 2-4 specific moments where the narrator demonstrated good reasoning, correct instinct, or effective technique. Quote or closely paraphrase what they said to anchor each observation. Explain *why* it was a good move — what principle or skill it reflects.

## Growth edges
Identify moments of hesitation, uncertainty, confusion, or self-correction. For each one:
- Describe what happened (quote their words when useful)
- Name the underlying concept or skill gap
- Explain what the confident version of that action looks like

These are not failures — frame them as the frontier where learning is actively happening.

## Concepts to reinforce
List the specific technical concepts, terms, or mental models the narrator engaged with but didn't seem fully solid on. For each, give a one-sentence explanation of what it is and why it matters — just enough to orient further study.

## Recommended next steps
Suggest 2-3 concrete, specific exercises or tasks that would strengthen the exact skills this session revealed as developing. Each should be doable in a single sitting and directly related to what was attempted.

Rules:
- Be specific, not generic. "Good job navigating the interface" is useless. "You correctly identified that the rollup field needed to reference the linked record before aggregating" is useful.
- Treat self-corrections as gold — they show the narrator catching their own mistakes, which is a skill in itself.
- The tone is that of a respected mentor: warm, direct, never condescending.

TRANSCRIPT:
{transcript}""",

    "notes": """You are cleaning up a narrated screen recording into polished, readable notes that preserve the narrator's thinking and reasoning.

The transcript is raw speech — full of filler words, restarts, verbal tics ("um," "so," "basically"), and mid-thought corrections. Your job is to produce notes that read like the narrator sat down afterward and wrote out what they did and why, in their own voice.

Guidelines:
- Strip all filler words, false starts, and verbal noise
- Preserve the narrator's actual reasoning, decisions, and observations — the *why* behind what they did
- Keep domain-specific terminology exactly as the narrator used it
- Add structure: use headings to mark topic shifts, paragraph breaks for readability
- When the narrator corrected themselves ("wait, no, actually..."), keep the corrected version and drop the false start — unless the mistake itself is informative
- Do not summarize away substance. If they explained something in detail, keep the detail
- Do not add information, opinions, or context the narrator didn't provide
- Output clean Markdown with natural paragraph flow, not bullet-point outlines

The result should feel like well-edited first-person notes — something the narrator would recognize as their own thinking, just cleaner.

TRANSCRIPT:
{transcript}""",

    "methodology": """You are producing a methodology document from a narrated screen recording — a document that explains what was built and the reasoning behind how it was designed.

This is not a step-by-step procedure (that's an SOP). This is the architectural rationale: what decisions were made, why, what trade-offs were weighed, and how the pieces fit together. The audience is someone who needs to understand the system — a client, a teammate, or the builder themselves six months from now.

The transcript is raw narration — expect thinking out loud, filler, false starts, and real-time problem-solving. Extract the design reasoning from the noise.

Produce the document in this structure:

# [System/build name — infer from context]

## What was built
A concise description of the system, tool, workflow, or structure that was created. What it does, who it's for, and the problem it solves.

## Architecture and design decisions
For each significant design choice:
- **What was decided** — the specific choice (e.g., "Used a junction table instead of a multi-select field")
- **Why** — the reasoning the builder gave, or the constraint that drove the decision
- **Trade-offs** — what was gained and what was given up, if the narrator discussed alternatives

Group related decisions together. Use the builder's own terminology.

## How the components connect
Describe how the pieces of the build relate to each other — the relationships, dependencies, data flow, or logic chain. This is the mental model someone needs to work on the system confidently.

## Assumptions and constraints
Things the build depends on that aren't obvious: data format expectations, permission requirements, upstream systems, volume assumptions, or business rules baked into the design.

## Open design questions
Anything the builder flagged as uncertain, provisional, or "good enough for now." Decisions they deferred or want to revisit. Omit if none.

Rules:
- Prioritize the *why* over the *what*. The build itself is visible; the reasoning behind it is what gets lost.
- When the narrator considered alternatives and rejected them, capture that — rejected options are as valuable as chosen ones.
- Self-corrections during narration often reveal real design tensions. Preserve them as trade-off discussions, not mistakes.
- Use specific names: field names, table names, automation names, actual values. Generic descriptions are useless in a methodology doc.
- Write for someone who is technically competent but has never seen this build before.

TRANSCRIPT:
{transcript}""",

    "title": """Given this transcript of a narrated screen recording, generate a concise, descriptive title (5-8 words). The title should name the specific task or topic — not a generic label. Return ONLY the title text, nothing else. No quotes, no punctuation unless part of a proper name.

TRANSCRIPT:
{transcript}""",

    "project_summary": """You are synthesizing multiple narrated screen recording sessions from the same project into a comprehensive project document.

The transcripts below are ordered chronologically. Each represents a separate work session where someone narrated what they were doing and why. Produce a living project summary that weaves everything together.

# Project Summary

## Overview
2-3 sentences: what this project is, based on everything discussed across all sessions.

## Timeline
For each session, a brief entry:
- When it happened
- What was accomplished
- Key decisions made

## Key decisions and reasoning
The major choices made across sessions, with the person's stated reasoning. The "why" behind each decision is the most valuable part — preserve it faithfully.

## Conflicts and course corrections
Places where the person changed their mind, contradicted an earlier approach, or revised their thinking:
- What they originally thought or did
- What they changed to
- Why (if stated)

These are not mistakes — they are the evolution of understanding. Frame them as valuable signal.

## Current state
Where things stand as of the most recent session. What works, what's pending, what's unresolved.

## Open questions
Anything left unresolved, flagged for revisiting, or explicitly uncertain across any session. Omit if none.

Rules:
- Synthesize across sessions, don't just summarize each one in order
- When the same topic appears in multiple sessions, weave those mentions together
- Use the person's own terminology
- Be specific — names, field names, technical terms, actual values mentioned
- Keep the document scannable: strong headings, short paragraphs, bullet points for lists

TRANSCRIPTS:
{transcript}""",
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("transcript", type=Path)
    p.add_argument("--mode", choices=PROMPTS.keys(), default="sop")
    p.add_argument("--stdout", action="store_true", help="Print result to stdout only")
    args = p.parse_args()

    if not args.transcript.exists():
        print(f"Transcript not found: {args.transcript}", file=sys.stderr)
        sys.exit(2)

    api_key = os.environ.get("ANTHROPIC_API_KEY") or _read_setting("anthropicApiKey")
    if not api_key:
        print("Anthropic API key not configured", file=sys.stderr)
        sys.exit(2)

    transcript = args.transcript.read_text(encoding="utf-8")
    if not transcript.strip():
        print("Transcript is empty", file=sys.stderr)
        sys.exit(2)

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=8000,
        messages=[{"role": "user", "content": PROMPTS[args.mode].format(transcript=transcript)}],
    )
    output = response.content[0].text

    if args.stdout:
        sys.stdout.write(output)
    else:
        out_path = args.transcript.with_name(f"{args.transcript.stem}_{args.mode}.md")
        out_path.write_text(output, encoding="utf-8")
        print(str(out_path))


def _read_setting(key):
    try:
        import sqlite3
        appdata = os.environ.get("APPDATA")
        if not appdata:
            return None
        db_path = Path(appdata) / "Mnemori" / "mnemori.db"
        if not db_path.exists():
            return None
        conn = sqlite3.connect(str(db_path))
        try:
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return row[0] if row else None
        finally:
            conn.close()
    except Exception:
        return None


if __name__ == "__main__":
    main()
