"""
WhatsApp Chat Message Extractor

Parses WhatsApp exported .txt chat files and outputs structured data as CSV or JSON.
Supports filtering by sender name and keyword.

Usage:
    python whatsapp_extractor.py <chat_export.txt> [options]

    # Extract all messages from Leong that contain "OT"
    python whatsapp_extractor.py chat.txt --sender Leong --keyword OT

WhatsApp Export:
    In WhatsApp: Chat > More > Export chat > Without Media
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
        "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
        "%d/%m/%y %H:%M:%S", "%d/%m/%y %H:%M",
        "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M",
        "%m/%d/%y %H:%M:%S", "%m/%d/%y %H:%M",
        "%d/%m/%Y %I:%M %p", "%d/%m/%Y %I:%M:%S %p",
        "%m/%d/%Y %I:%M %p", "%m/%d/%Y %I:%M:%S %p",
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
                current.message += "\n" + line

    if current:
        messages.append(current)

    return messages


def filter_messages(
    messages: list[Message],
    sender: Optional[str] = None,
    keyword: Optional[str] = None,
) -> list[Message]:
    result = messages
    if sender:
        result = [m for m in result if sender.lower() in m.sender.lower()]
    if keyword:
        result = [m for m in result if keyword.lower() in m.message.lower()]
    return result


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


def print_summary(messages: list[Message], filtered: list[Message], sender: Optional[str], keyword: Optional[str]) -> None:
    print(f"\nTotal messages in chat : {len(messages)}")
    if sender or keyword:
        label = []
        if sender:
            label.append(f"sender contains '{sender}'")
        if keyword:
            label.append(f"message contains '{keyword}'")
        print(f"Filter applied         : {' AND '.join(label)}")
        print(f"Messages matched       : {len(filtered)}")
    if filtered:
        print(f"Date range             : {filtered[0].date}  →  {filtered[-1].date}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract and filter WhatsApp chat messages."
    )
    parser.add_argument("input", help="Path to the WhatsApp exported .txt file")
    parser.add_argument("--sender", help="Filter by sender name (partial match, e.g. 'Leong')")
    parser.add_argument("--keyword", help="Filter messages containing this word (e.g. 'OT')")
    parser.add_argument("--format", choices=["csv", "json"], default="csv")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()

    try:
        messages = extract_messages(args.input)
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    filtered = filter_messages(messages, sender=args.sender, keyword=args.keyword)
    print_summary(messages, filtered, args.sender, args.keyword)

    if args.summary_only or not filtered:
        return

    output_path = args.output or f"{Path(args.input).stem}_filtered.{args.format}"

    if args.format == "json":
        write_json(filtered, output_path)
    else:
        write_csv(filtered, output_path)

    print(f"\nSaved {len(filtered)} messages → {output_path}")


if __name__ == "__main__":
    main()
