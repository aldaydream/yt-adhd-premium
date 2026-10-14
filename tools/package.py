"""Package the extension folder with README and LICENSE into a ZIP for manual installation."""
import json
import zipfile
from pathlib import Path

project = Path(__file__).resolve().parents[1]
source = project / 'extension'
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
target = project / f'adhd-multiview-{manifest["version"]}.zip'
files = sorted(file for file in source.rglob('*') if file.is_file())
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, 'adhd-multiview/' + file.relative_to(source).as_posix())
    for extra in ('README.md', 'LICENSE'):
        if (project / extra).exists():
            archive.write(project / extra, 'adhd-multiview/' + extra)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('adhd-multiview/manifest.json')) == manifest
    assert all(not name.startswith('/') and '..' not in name.split('/') for name in archive.namelist())
    for file in files:
        assert archive.read('adhd-multiview/' + file.relative_to(source).as_posix()) == file.read_bytes()
    print(f'ZIP verified: {len(archive.namelist())} files, {target.stat().st_size} bytes')
print(target)
