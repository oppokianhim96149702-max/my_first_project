"""
WhatsApp Chat Message Extractor

Parses WhatsApp exported .txt chat files and outputs structured data as CSV or JSON.

Usage:
    python whatsapp_extractor.py <chat_export.txt> [--format csv|json] [--output output_file]

WhatsApp Export:
    In WhatsApp: Chat > ⋮ > More > Export chat > Without Media
    This produces a .txt file this script can parse.
"""

import re
import csv
import json
import argparse
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional


# Matches both common WhatsApp export date formats:
#   [DD/MM/YYYY, HH:MM:SS] Sender: Message   (iOS)
#   MM/DD/YYYY, HH:MM - Sender: Message       (Android)
_IOS_PATTERN = re.compile(
    r"^\[(\d{1,2}/\d{1,2}/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]\s(.+?):\s(.+)$"
)
_ANDROID_PATTERN = re.compile(
    r"^(\d{1,2}/\d{1,2}/\d{2,4}),\s(\d{1,2}:\d{2}(?:\s?[AP]M)?)\s-\s(.+?):\s(.+)$"
)


@dataclass
class Message:
    date: str
    time: str
    sender: str
    message: str
    datetime_parsed: Optional[str] = None


def _parse_datetime(date_str: str, time_str: str) -> Optional[str]:
    formats = [
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%y %H:%M:%S",
        "%d/%m/%y %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%y %H:%M:%S",
        "%m/%d/%y %H:%M",
        "%d/%m/%Y %I:%M %p",
        "%d/%m/%Y %I:%M:%S %p",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%Y %I:%M:%S %p",
    ]
    combined = f"{date_str} {time_str.strip()}"
    for fmt in formats:
        try:
            return datetime.strptime(combined, fmt).isoformat()
        except ValueError:
            continue
    return None


def extract_messages(file_path: str) -> list[Message]:
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    messages: list[Message] = []
    current: Optional[Message] = None

    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")

            matched = _IOS_PATTERN.match(line) or _ANDROID_PATTERN.match(line)
            if matched:
                # Save any accumulated multi-line message
                if current:
                    messages.append(current)
                date, time, sender, text = matched.groups()
                current = Message(
                    date=date,
                    time=time,
                    sender=sender.strip(),
                    message=text.strip(),
                    datetime_parsed=_parse_datetime(date, time),
                )
            elif current and line.strip():
                # Continuation of a multi-line message
                current.message += "\n" + line

    if current:
        messages.append(current)

    return messages


def write_csv(messages: list[Message], output_path: str) -> None:
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["date", "time", "datetime_parsed", "sender", "message"]
        )
        writer.writeheader()
        for msg in messages:
            writer.writerow(asdict(msg))


def write_json(messages: list[Message], output_path: str) -> None:
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump([asdict(m) for m in messages], f, ensure_ascii=False, indent=2)


def print_summary(messages: list[Message]) -> None:
    if not messages:
        print("No messages found.")
        return

    senders = {}
    for msg in messages:
        senders[msg.sender] = senders.get(msg.sender, 0) + 1

    print(f"\nTotal messages : {len(messages)}")
    print(f"Participants   : {len(senders)}")
    print(f"Date range     : {messages[0].date}  →  {messages[-1].date}")
    print("\nMessages per participant:")
    for sender, count in sorted(senders.items(), key=lambda x: -x[1]):
        print(f"  {sender:<40} {count}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract and parse WhatsApp exported chat messages."
    )
    parser.add_argument("input", help="Path to the WhatsApp exported .txt file")
    parser.add_argument(
        "--format",
        choices=["csv", "json"],
        default="csv",
        help="Output format (default: csv)",
    )
    parser.add_argument(
        "--output",
        help="Output file path (default: <input_name>.<format>)",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print a summary without writing an output file",
    )
    args = parser.parse_args()

    try:
        messages = extract_messages(args.input)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    print_summary(messages)

    if args.summary_only or not messages:
        return

    output_path = args.output or f"{Path(args.input).stem}.{args.format}"

    if args.format == "json":
        write_json(messages, output_path)
    else:
        write_csv(messages, output_path)

    print(f"\nSaved {len(messages)} messages → {output_path}")


if __name__ == "__main__":
    main()
