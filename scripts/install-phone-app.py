#!/usr/bin/env python3
"""Build the local capture permission owner; does not grant OS permissions or start capture."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--replace', action='store_true', help='Replace an existing GrokGrid Phone build after stopping it')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
app = Path.home() / 'Applications/GrokGrid Phone.app'
config = Path.home() / '.config/grokgrid/runtime/local-phone-config.json'
node = shutil.which('node')
if not node or not config.is_file():
    raise SystemExit('Node and a private pinned publisher config are required.')
if app.exists() and not args.replace:
    raise SystemExit('App already exists. Stop it before an explicit --replace build.')
if app.is_symlink():
    raise SystemExit('Refusing symbolic-link app destination.')
exe = app / 'Contents/MacOS/GrokGridPhone'
exe.parent.mkdir(parents=True, exist_ok=True)
info = {
    'CFBundleExecutable': 'GrokGridPhone', 'CFBundleIdentifier': 'fun.grokgrid.phone',
    'CFBundleName': 'GrokGrid Phone', 'CFBundleDisplayName': 'GrokGrid Phone',
    'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0', 'CFBundlePackageType': 'APPL',
    'LSUIElement': True,
    'NSAppleEventsUsageDescription': 'Verify the exact pump.fun tab selected for your GrokGrid live screen.',
    'NSScreenCaptureUsageDescription': 'Capture only the selected GrokGrid browser window for the live phone feed.',
    'GrokGridNodePath': node, 'GrokGridSupervisorPath': str(repo / 'scripts/phone-supervisor.mjs'),
    'GrokGridConfigPath': str(config),
}
with (app / 'Contents/Info.plist').open('wb') as f:
    plistlib.dump(info, f)
subprocess.run(['/usr/bin/swiftc', str(repo / 'scripts/phone-app.swift'), '-o', str(exe), '-framework', 'AppKit', '-framework', 'CoreGraphics'], check=True)
subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
print('Built GrokGrid Phone. Open it and grant its macOS capture permission; no feed was started by this installer.')
