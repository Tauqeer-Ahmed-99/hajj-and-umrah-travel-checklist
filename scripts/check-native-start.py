"""Cold-start the actual installed app and assert its expected native screen."""
import argparse
import subprocess
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--adb", default="adb")
parser.add_argument("--serial", required=True)
parser.add_argument("--text", default="First name")
args = parser.parse_args()


def call(*command):
    result = subprocess.run([args.adb, "-s", args.serial, *command], capture_output=True, encoding="utf-8", errors="replace", timeout=6)
    if result.returncode:
        raise RuntimeError("ADB command failed; inspect the task-owned device.")
    return result.stdout


call("shell", "am", "force-stop", "in.nmtsolutions.travel")
call("shell", "am", "start", "-n", "in.nmtsolutions.travel/.MainActivity")
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    try:
        call("shell", "uiautomator", "dump", "/sdcard/nmt-release-start.xml")
        tree = ET.fromstring(call("shell", "cat", "/sdcard/nmt-release-start.xml"))
    except (subprocess.TimeoutExpired, ET.ParseError):
        continue
    if any(node.get("text") == args.text for node in tree.iter("node")):
        print("PASS: expected native screen reached after standalone cold start.")
        raise SystemExit(0)
print("FAIL: expected native screen not reached within 30 seconds.")
raise SystemExit(1)
