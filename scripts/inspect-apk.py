"""Inspect an actual signed APK; never print the contents of secrets or bundles."""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args):
    result = subprocess.run(args, capture_output=True, encoding="utf-8", errors="replace", check=False)
    require(result.returncode == 0, f"Artifact tool failed: {Path(args[0]).name}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--build-tools", required=True, type=Path)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--api", required=True)
    parser.add_argument("--clerk-key", required=True)
    parser.add_argument("--secret-file", action="append", default=[], type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    require(args.secret_file, "Supply the actual server secret files to scan against.")
    require(args.api.startswith("https://"), "Distributed preview must use an HTTPS API.")
    tools = args.build_tools
    executable = ".exe" if sys.platform == "win32" else ""
    signer = run(
        "java", "-jar", str(tools / "lib" / "apksigner.jar"),
        "verify", "--print-certs", str(args.apk),
    )
    certificates = re.findall(r"certificate SHA-256 digest: ([a-fA-F0-9]+)", signer)
    sha1 = re.findall(r"certificate SHA-1 digest: ([a-fA-F0-9]+)", signer)
    require(len(certificates) == 1, "APK must have one expected signing certificate.")
    expected = "f6e8630d6745ac7920f15c8bdea855f90880e4e12953645f92a9a1979298ced5"
    require(certificates[0].lower() == expected, "APK signing identity changed.")
    require(sha1 == ["0288616a602fac032b2a0ff1cd37f0324b66bcf2"], "APK SHA-1 differs from the registered Google Android client.")
    badging = run(str(tools / f"aapt2{executable}"), "dump", "badging", str(args.apk))
    require("package: name='in.nmtsolutions.travel'" in badging, "Wrong Android package.")
    require("application-label:'NMT Travel'" in badging, "Wrong application label.")
    require("application-debuggable" not in badging, "Development/debug APK is not a signed release preview.")
    manifest = run(
        str(tools / f"aapt2{executable}"), "dump", "xmltree", str(args.apk),
        "--file", "AndroidManifest.xml",
    )
    require("expo.modules.updates.ENABLED" in manifest, "EAS Update metadata missing.")
    require("https://u.expo.dev/8c2739c3-9d23-4c92-a50a-836d3ea3a94c" in manifest, "Wrong update project.")
    resources = run(str(tools / f"aapt2{executable}"), "dump", "resources", str(args.apk))
    runtime_resource = re.search(r'resource (0x[0-9a-f]+) string/expo_runtime_version\s+\(\) "([^"]+)"', resources)
    require(runtime_resource, "Native runtime resource missing.")
    runtime_metadata = manifest.split("expo.modules.updates.EXPO_RUNTIME_VERSION", 1)[-1].split("E: meta-data", 1)[0]
    require(runtime_resource[1] in runtime_metadata, "Update runtime does not reference the expected resource.")
    require("expo-channel-name" in manifest and args.channel in manifest, "Wrong update channel.")
    check_metadata = manifest.split("expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH", 1)[-1].split("E: meta-data", 1)[0]
    require('"ALWAYS"' in check_metadata, "Expected native startup update check missing.")
    wait_metadata = manifest.split("expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS", 1)[-1].split("E: meta-data", 1)[0]
    require(re.search(r'android:value[^\n]*=0(?:\n|$)', wait_metadata), "Startup must not wait to apply a downloaded update during an active session.")
    for permission in ["READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "DOWNLOAD_WITHOUT_NOTIFICATION", "SCHEDULE_EXACT_ALARM"]:
        require(f"android.permission.{permission}" not in manifest, f"Unexpected permission: {permission}")

    secret_names = {"DATABASE_URL", "CLERK_SECRET_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "EXPO_ACCESS_TOKEN", "CRON_SECRET"}
    secrets = []
    for file in args.secret_file:
        content = file.read_text(encoding="utf-8-sig")
        if file.suffix == ".json":
            data = json.loads(content)
            for value in [data.get("private_key"), data.get("client_secret"), data.get("web", {}).get("client_secret")]:
                if value:
                    secrets.extend([value, value.replace("\n", "\\n")])
            continue
        for line in content.splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            name, value = line.split("=", 1)
            if name in secret_names and value.strip():
                value = value.strip().strip("\"'")
                secrets.append(value)
                if name == "DATABASE_URL":
                    password = urlparse(value).password
                    if password:
                        secrets.append(unquote(password))
    require(secrets, "No populated server secret values were supplied.")
    patterns = [rb"sk_(?:test|live)_[A-Za-z0-9]{15,}", rb"GOCSPX-[A-Za-z0-9_-]{15,}", rb"postgres(?:ql)?://[^\s\x00]+:[^\s\x00]+@", rb"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----"]
    expected_public = {"api": args.api.encode(), "clerk": args.clerk_key.encode()}
    found_public = set()
    scanned_bytes = 0
    bundle = None
    with zipfile.ZipFile(args.apk) as archive:
        names = archive.namelist()
        require("assets/app.manifest" in names, "Embedded update manifest missing.")
        embedded = json.loads(archive.read("assets/app.manifest"))
        # SDK58 resolves file:fingerprint from this embedded asset at native startup.
        # Its build manifest has id/commitTime/assets rather than an OTA manifest's
        # runtimeVersion/launchAsset. Read the installed native artifact's format.
        if runtime_resource[2] == "file:fingerprint":
            require("assets/fingerprint" in names, "Embedded native fingerprint missing.")
            require(archive.read("assets/fingerprint").decode("utf-8") == args.runtime, "Embedded runtime differs from expected EAS fingerprint.")
        else:
            require(runtime_resource[2] == args.runtime, "Native runtime differs from expected runtime.")
        require(embedded.get("id") and isinstance(embedded.get("assets"), list), "Invalid SDK58 embedded update manifest.")
        for entry in archive.infolist():
            require(entry.file_size < 256 * 1024 * 1024, "Unexpectedly large APK entry; inspect manually.")
            if entry.is_dir():
                continue
            require(not re.search(r"(?:^|/)\.env(?:\.|$)|\.(?:jks|keystore|p12)$", entry.filename), "Credential file embedded in APK.")
            data = archive.read(entry)
            scanned_bytes += len(data)
            for secret in secrets:
                require(secret.encode() not in data and secret.encode("utf-16le") not in data, "Known server secret found in APK; do not distribute.")
            require(not any(re.search(pattern, data) for pattern in patterns), "Server credential pattern found in APK; do not distribute.")
            for name, value in expected_public.items():
                if value in data:
                    found_public.add(name)
            if entry.filename == "assets/index.android.bundle":
                # Hermes bytecode magic, independent of the file extension.
                require(data[:8] == bytes.fromhex("c61fbc03c103191f"), "Embedded bundle is not Hermes bytecode.")
                bundle = hashlib.sha256(data).hexdigest()
    require(bundle, "Standalone embedded Android bundle missing.")
    require(found_public == {"api", "clerk"}, "Expected public API/Clerk configuration absent from artifact.")
    version = re.search(r"versionCode='(\d+)'", badging)
    report = {
        "apk": str(args.apk.resolve()), "sha256": hashlib.file_digest(args.apk.open("rb"), "sha256").hexdigest(),
        "package": "in.nmtsolutions.travel", "versionCode": int(version[1]) if version else None,
        "certificateSha256": certificates[0].lower(), "certificateSha1": sha1[0], "runtime": args.runtime, "channel": args.channel,
        "embeddedUpdateId": embedded.get("id"), "bundleSha256": bundle,
        "scannedUncompressedBytes": scanned_bytes, "knownServerSecretsScanned": len(secrets),
        "result": "artifact checks passed; device and production acceptance remain separate",
    }
    text = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"APK inspection failed: {error}", file=sys.stderr)
        sys.exit(1)
