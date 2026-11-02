#!/usr/bin/env python3
"""Install root-owned. Read a deployment key from stdin without logging it."""
import fcntl, os, re, sys, tempfile
from pathlib import Path
if os.geteuid() != 0:
    raise SystemExit('Root required')
key = sys.stdin.read().strip()
if not re.fullmatch(r'[a-fA-F0-9]{64}', key):
    raise SystemExit('Expected a 256-bit hexadecimal encryption key')
path = Path('/etc/scaletag.env')
with open('/run/scaletag-encryption.lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    lines = path.read_text().splitlines()
    prior = [s.split('=', 1)[1] for s in lines if s.startswith('SCALETAG_ENCRYPTION_KEY=')]
    if prior and any(s.lower() != key.lower() for s in prior):
        raise SystemExit('Key rotation requires a separate migration; refusing replacement')
    lines = [s for s in lines if not s.startswith('SCALETAG_ENCRYPTION_KEY=')]
    fd, name = tempfile.mkstemp(prefix='.scaletag-env-', dir='/etc')
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write('\n'.join(lines) + '\nSCALETAG_ENCRYPTION_KEY=' + key + '\n')
            stream.flush(); os.fsync(stream.fileno())
        os.chown(name, 0, 0); os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)
