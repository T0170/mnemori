"""
transcribe.py - Called by the Electron main process via child_process.

Reads a WAV file path from argv, sends it to Whisper, writes:
  <basename>.txt   plain transcript
  <basename>.json  timestamped segments
"""
import sys
import os
import json
from pathlib import Path

from openai import OpenAI


def main():
    if len(sys.argv) != 2:
        print("Usage: transcribe.py <wav-path>", file=sys.stderr)
        sys.exit(2)

    wav_path = Path(sys.argv[1])
    if not wav_path.exists():
        print(f"File not found: {wav_path}", file=sys.stderr)
        sys.exit(2)

    api_key = os.environ.get("OPENAI_API_KEY") or _read_setting("openaiApiKey")
    if not api_key:
        print("OpenAI API key not configured", file=sys.stderr)
        sys.exit(2)

    client = OpenAI(api_key=api_key)
    with open(wav_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    txt_path = wav_path.with_suffix(".txt")
    txt_path.write_text(result.text, encoding="utf-8")

    json_path = wav_path.with_suffix(".json")
    segments = [{"start": s.start, "end": s.end, "text": s.text} for s in result.segments]
    json_path.write_text(json.dumps(segments, indent=2), encoding="utf-8")

    print(json.dumps({"ok": True, "txt": str(txt_path), "json": str(json_path)}))


def _read_setting(key):
    """Read a setting from the Electron-managed SQLite database."""
    try:
        import sqlite3
        from pathlib import Path
        # appdata path mirrors what Electron uses on Windows
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
