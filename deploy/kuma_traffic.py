#!/usr/bin/env python3
"""Add a local traffic summary to an existing ScaleTag Kuma heartbeat."""
import ast
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys
from tempfile import NamedTemporaryFile
from urllib.request import ProxyHandler, build_opener


def read_stats(port):
    opener = build_opener(ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{int(port)}/api/stats", timeout=2) as response:
        return json.load(response)


def with_traffic(health, port):
    try:
        stats = read_stats(port)
        parts = [health]
        for days in (7, 30):
            window = stats[f"days{days}"]
            counts = {"visits": window["visits"], **{
                name: window["created"][name] for name in ("polls", "tasks", "giveaways", "secrex")
            }}
            if any(type(value) is not int or value < 0 for value in counts.values()):
                return health
            parts.append(f"{days}d: " + " ".join(f"{key}={value}" for key, value in counts.items()))
        summary = " | ".join(parts)
        if len(summary) > 240:
            return health
        if os.environ.get("SCALETAG_VERIFY_KUMA_TRAFFIC") == "1":
            print("ScaleTag traffic summary attached", file=sys.stderr)
        return summary
    except (OSError, ValueError, KeyError, TypeError):
        return health


IMPORT = b"from scaletag_kuma_traffic import with_traffic as scaletag_with_traffic"


def patched_source(source, port):
    tree = ast.parse(source)
    matches = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        fields = {key.value: value for key, value in zip(node.keys, node.values)
                  if isinstance(key, ast.Constant) and isinstance(key.value, str)}
        if {"status", "msg", "ping"} <= fields.keys():
            matches.append(fields["msg"])
    if len(matches) != 1:
        raise ValueError("Unsupported Kuma collector message")
    message = matches[0]
    lines = source.splitlines(keepends=True)
    if isinstance(message, ast.Call) and isinstance(message.func, ast.Name) and message.func.id == "scaletag_with_traffic":
        original = message.args[0]
    else:
        original = message
    if message.lineno != message.end_lineno or original.lineno != original.end_lineno:
        raise ValueError("Unsupported multiline Kuma collector message")
    line = lines[message.lineno - 1]
    value = lines[original.lineno - 1][original.col_offset:original.end_col_offset]
    replacement = b"scaletag_with_traffic(" + value + f", {int(port)})".encode()
    lines[message.lineno - 1] = line[:message.col_offset] + replacement + line[message.end_col_offset:]

    if IMPORT not in source.splitlines():
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module == "__future__":
                continue
            if node is tree.body[0] and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                continue
            lines.insert(node.lineno - 1, IMPORT + b"\n")
            break
    patched = b"".join(lines)
    compile(patched, "healthcheck.py", "exec")
    return patched


def atomic_write(path, data, mode):
    with NamedTemporaryFile(dir=path.parent, delete=False) as temp:
        staged = Path(temp.name)
        try:
            temp.write(data)
            temp.flush()
            os.fsync(temp.fileno())
            os.chmod(staged, mode)
            os.replace(staged, path)
        finally:
            staged.unlink(missing_ok=True)


def install(collector, port, helper):
    if collector.is_symlink() or not collector.is_file():
        raise ValueError("Expected an existing regular healthcheck.py")
    source = collector.read_bytes()
    patched = patched_source(source, port)
    destination = collector.with_name("scaletag_kuma_traffic.py")
    if destination.is_symlink() or not destination.is_file() or destination.read_bytes() != helper:
        atomic_write(destination, helper, 0o600)
    if patched != source:
        atomic_write(collector, patched, collector.stat().st_mode & 0o700)


def main(port):
    try:
        account = pwd.getpwnam("ubuntu")
    except KeyError:
        print("No ScaleTag Kuma collector user")
        return
    helper = Path(__file__).read_bytes()
    collector = Path(account.pw_dir) / ".local/share/scaletag-monitor/healthcheck.py"
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    if not collector.exists():
        print("No existing ScaleTag Kuma collector")
        return
    install(collector, port, helper)
    result = subprocess.run(
        [sys.executable, str(collector)], capture_output=True, text=True, timeout=20,
        env={"PATH": "/usr/bin:/bin", "HOME": account.pw_dir, "SCALETAG_VERIFY_KUMA_TRAFFIC": "1"},
        cwd=collector.parent,
    )
    if (result.returncode == 0 and "ScaleTag traffic summary attached" in result.stderr
            and re.search(r"\bkuma=acknowledged\b", result.stdout)):
        print("ScaleTag traffic summary accepted by the existing Kuma push monitor")
    else:
        raise RuntimeError("Kuma delivery could not be verified")


if __name__ == "__main__":
    try:
        main(int(sys.argv[1]))
    except (IndexError, OSError, ValueError, RuntimeError, SyntaxError, subprocess.TimeoutExpired):
        print("ScaleTag traffic collector update or delivery verification failed", file=sys.stderr)
        sys.exit(1)
