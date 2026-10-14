const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname,'..');
const extension = path.join(project,'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.permissions,['activeTab','scripting','storage','declarativeNetRequestWithHostAccess']);
assert.deepEqual(manifest.host_permissions,['https://www.youtube.com/*','https://www.youtube-nocookie.com/*']);
for(const file of ['core.js','content.js','page-bridge.js',manifest.background.service_worker]) {
  const checked = spawnSync(process.execPath,['--check',path.join(extension,file)],{encoding:'utf8'});
  if(checked.status !== 0) throw new Error(checked.stderr || `${file}: syntax check failed`);
}
for(const file of Object.values(manifest.icons)) {
  const bytes=fs.readFileSync(path.join(extension,file));
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
}
assert.match(manifest.key || '', /^[A-Za-z0-9+/=]{300,}$/, 'manifest key keeps the extension id stable');
assert(!/youtube/i.test(manifest.name), 'the extension name must not use the YouTube trademark');
assert(!manifest.externally_connectable);
assert(!manifest.web_accessible_resources);
console.log('Manifest, permissions, JavaScript syntax and 4 PNG icons: PASS');
