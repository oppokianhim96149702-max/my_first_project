import json
import tempfile
import os
from pathlib import Path
from whatsapp_extractor import extract_messages, write_csv, write_json

# Sample chat in iOS format
IOS_CHAT = """\
[28/05/2024, 09:15:32] Alice: Good morning everyone!
[28/05/2024, 09:16:00] Bob: Morning Alice 👋
[28/05/2024, 09:16:45] Alice: Did you check the report?
[28/05/2024, 09:17:10] Bob: Not yet, sending now
this is the rest of the file
[28/05/2024, 09:18:00] Charlie: I reviewed it already
"""

# Sample chat in Android format
ANDROID_CHAT = """\
5/28/2024, 9:15 AM - Alice: Good morning everyone!
5/28/2024, 9:16 AM - Bob: Morning Alice
5/28/2024, 9:16 AM - Alice: Did you see the schedule?
5/28/2024, 9:17 AM - Bob: Yes, looks good
"""

SYSTEM_MESSAGES = """\
[28/05/2024, 08:00:00] Messages and calls are end-to-end encrypted.
[28/05/2024, 09:15:32] Alice: Hello
[28/05/2024, 09:16:00] Bob: Hi there
"""


def write_tmp(content: str) -> str:
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8")
    f.write(content)
    f.close()
    return f.name


def test_ios_format():
    path = write_tmp(IOS_CHAT)
    msgs = extract_messages(path)
    os.unlink(path)
    assert len(msgs) == 5, f"Expected 5, got {len(msgs)}"
    assert msgs[0].sender == "Alice"
    assert msgs[0].date == "28/05/2024"
    assert msgs[0].time == "09:15:32"
    assert msgs[3].message == "Not yet, sending now\nthis is the rest of the file"
    assert msgs[0].datetime_parsed == "2024-05-28T09:15:32"
    print("PASS  iOS format")


def test_android_format():
    path = write_tmp(ANDROID_CHAT)
    msgs = extract_messages(path)
    os.unlink(path)
    assert len(msgs) == 4, f"Expected 4, got {len(msgs)}"
    assert msgs[1].sender == "Bob"
    print("PASS  Android format")


def test_system_messages_skipped():
    path = write_tmp(SYSTEM_MESSAGES)
    msgs = extract_messages(path)
    os.unlink(path)
    # System message has no sender: colon pattern → no sender field → skipped
    assert len(msgs) == 2, f"Expected 2, got {len(msgs)}"
    assert msgs[0].sender == "Alice"
    print("PASS  System messages skipped")


def test_csv_output():
    path = write_tmp(IOS_CHAT)
    msgs = extract_messages(path)
    os.unlink(path)
    out = tempfile.mktemp(suffix=".csv")
    write_csv(msgs, out)
    content = Path(out).read_text(encoding="utf-8")
    os.unlink(out)
    assert "Alice" in content
    assert "Good morning everyone!" in content
    print("PASS  CSV output")


def test_json_output():
    path = write_tmp(IOS_CHAT)
    msgs = extract_messages(path)
    os.unlink(path)
    out = tempfile.mktemp(suffix=".json")
    write_json(msgs, out)
    data = json.loads(Path(out).read_text(encoding="utf-8"))
    os.unlink(out)
    assert isinstance(data, list)
    assert data[0]["sender"] == "Alice"
    print("PASS  JSON output")


if __name__ == "__main__":
    test_ios_format()
    test_android_format()
    test_system_messages_skipped()
    test_csv_output()
    test_json_output()
    print("\nAll tests passed.")
