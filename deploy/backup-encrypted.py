#!/usr/bin/env python3
"""Root backup entrypoint: encrypted export produced inside the serving app."""
import argparse, datetime, fcntl, json, os, re, subprocess, tempfile
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--data-dir',default='/ScaleTag/data')
p.add_argument('--backup-dir',default='/ScaleTag/backups')
p.add_argument('--retention-days',type=int,default=90)
a=p.parse_args()
if a.retention_days < 1: raise SystemExit('Invalid retention')
os.umask(0o077)
dest=Path(a.backup_dir);dest.mkdir(mode=0o700,parents=True,exist_ok=True)
with open(dest/'.backup.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 ids=subprocess.check_output(['docker','ps','--filter','label=com.docker.compose.project=scaletag-ha','--format','{{.ID}} {{.Label "com.docker.compose.service"}}'],text=True)
 target=next((line.split()[0] for line in ids.splitlines() if line.split()[1] in ('app1','app2')),None)
 if not target: raise SystemExit('No serving ScaleTag container')
 # Protect retained legacy archives before publishing new encrypted backups.
 for legacy in dest.glob('scaletag-data-*.tar.gz'):
  if legacy.is_symlink() or not legacy.is_file(): raise SystemExit('Invalid legacy archive')
  fd,temporary=tempfile.mkstemp(prefix='.scaletag-legacy-',suffix='.partial',dir=dest)
  try:
   with os.fdopen(fd,'wb') as out, legacy.open('rb') as src:
    subprocess.run(['docker','exec','-i',target,'node','/app/src/encrypt-archive.js','--encrypt'],stdin=src,stdout=out,check=True)
    out.flush();os.fsync(out.fileno())
   with open(temporary,'rb') as src:
    subprocess.run(['docker','exec','-i',target,'node','/app/src/encrypt-archive.js','--verify'],stdin=src,stdout=subprocess.DEVNULL,check=True)
   os.replace(temporary,str(legacy)+'.aes.json')
   legacy.unlink()
  finally: Path(temporary).unlink(missing_ok=True)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
 fd,name=tempfile.mkstemp(prefix='.scaletag-encrypted-',suffix='.partial',dir=dest)
 try:
  with os.fdopen(fd,'wb') as out:
   subprocess.run(['docker','exec',target,'node','/app/src/encrypted-backup.js'],stdout=out,check=True)
   out.flush();os.fsync(out.fileno())
  with open(name,'rb') as src:
   subprocess.run(['docker','exec','-i',target,'node','/app/src/encrypted-backup.js','--verify'],stdin=src,stdout=subprocess.DEVNULL,check=True)
  final=dest/f'scaletag-data-{stamp}.aes.json';os.replace(name,final)
  cutoff=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=a.retention_days)
  for old in dest.glob('scaletag-data-*.aes.json'):
   try: created=datetime.datetime.strptime(old.name[14:-9].removesuffix('.tar.gz'),'%Y%m%dT%H%M%S.%fZ').replace(tzinfo=datetime.timezone.utc)
   except ValueError: continue
   if created<=cutoff:old.unlink()
  print(json.dumps({'verified':True,'archive':str(final)}))
 finally:
  Path(name).unlink(missing_ok=True)
