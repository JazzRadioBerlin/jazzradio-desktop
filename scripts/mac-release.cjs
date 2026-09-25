/* Node 24 on macOS. Credentials stay in the login Keychain. */
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs, promisify } = require('node:util');
const { createRequire } = require('node:module');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const team = '2MHNF9468Q';
const run = (file, args) => exec(file, args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });

async function verifyApp(appPath, signed) {
  const executable = path.join(appPath, 'Contents', 'MacOS', 'JazzRadio');
  const { stdout: architectures } = await run('/usr/bin/lipo', ['-archs', executable]);
  assert(architectures.includes('x86_64') && architectures.includes('arm64'), 'Both Mac architectures are required');
  if (!signed) return;
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const { stderr: signature } = await run('/usr/bin/codesign', ['--display', '--verbose=4', appPath]);
  assert(signature.includes(`TeamIdentifier=${team}`), 'Unexpected signing team');
  assert(signature.includes('Authority=Developer ID Application:'), 'Developer ID signing is required');
  assert(/flags=.*runtime/.test(signature), 'Hardened runtime is required');
  assert(signature.includes('Timestamp='), 'Secure signing timestamp is required');
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string' },
    unsigned: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('node scripts/mac-release.cjs --output /absolute/new-directory [--unsigned]');
    console.log('Signed release: set JAZZRADIO_DEVELOPER_ID_IDENTITY and JAZZRADIO_NOTARY_PROFILE.');
    console.log('--unsigned creates a clearly labelled packaging preview without uploading anything.');
    return;
  }
  assert(process.platform === 'darwin', 'Build on macOS');
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24');
  assert(values.output && path.isAbsolute(values.output), '--output must be an absolute, new directory');
  assert(!process.env.JAZZRADIO_MAS, 'Unset JAZZRADIO_MAS for direct distribution');
  const signed = !values.unsigned;
  const identity = process.env.JAZZRADIO_DEVELOPER_ID_IDENTITY;
  const profile = process.env.JAZZRADIO_NOTARY_PROFILE;
  const { stdout: dirty } = await run('/usr/bin/git', ['status', '--porcelain']);
  if (signed) {
    assert(identity && /^Developer ID Application: .+ \(2MHNF9468Q\)$/.test(identity), 'Set JazzRadio Developer ID identity');
    assert(profile, 'Set the JazzRadio notarization Keychain profile name');
    assert.equal(dirty.trim(), '', 'Commit and publish the exact source before a signed release');
    const { stdout: identities } = await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
    assert(identities.includes(`"${identity}"`), 'JazzRadio Developer ID certificate and private key are unavailable');
    await run('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', profile, '--output-format', 'json']);
  }
  const { stdout: revision } = await run('/usr/bin/git', ['rev-parse', 'HEAD']);
  const { version } = require('../package.json');
  const output = path.resolve(values.output);
  await fs.mkdir(output); // Never overwrite an existing release or signed store build.
  process.env.JAZZRADIO_DIRECT = signed ? 'distribution' : 'unsigned';
  const packageRoot = path.join(output, 'package');
  console.log(`Building JazzRadio ${version} for Intel and Apple Silicon…`);
  await require('@electron-forge/core').api.package({ dir: root, outDir: packageRoot, platform: 'darwin', arch: 'universal' });
  const appPath = path.join(packageRoot, 'JazzRadio-darwin-universal', 'JazzRadio.app');
  await verifyApp(appPath, signed);
  if (signed) {
    console.log('Submitting the signed app to Apple for notarization…');
    const packagerRequire = createRequire(require.resolve('@electron/packager'));
    await packagerRequire('@electron/notarize').notarize({ appPath, keychainProfile: profile });
    await run('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
    await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
  }

  const imageContents = path.join(output, 'image-contents');
  await fs.mkdir(imageContents);
  await run('/usr/bin/ditto', [appPath, path.join(imageContents, 'JazzRadio.app')]);
  await fs.symlink('/Applications', path.join(imageContents, 'Applications'));
  const filename = `JazzRadio-${version}-universal${signed ? '' : '-UNSIGNED'}.dmg`;
  const dmgPath = path.join(output, filename);
  console.log('Creating the drag-to-Applications disk image…');
  await run('/usr/bin/hdiutil', ['create', '-volname', 'JazzRadio', '-srcfolder', imageContents, '-ov', '-format', 'UDZO', '-fs', 'HFS+', dmgPath]);
  await run('/usr/bin/hdiutil', ['verify', dmgPath]);
  if (signed) {
    await run('/usr/bin/codesign', ['--sign', identity, '--timestamp', dmgPath]);
    await run('/usr/bin/codesign', ['--verify', '--verbose=2', dmgPath]);
    console.log('Submitting the disk image to Apple for notarization…');
    const { stdout } = await run('/usr/bin/xcrun', ['notarytool', 'submit', dmgPath, '--keychain-profile', profile, '--wait', '--output-format', 'json']);
    const submission = JSON.parse(stdout);
    await fs.writeFile(path.join(output, 'notarization.json'), `${JSON.stringify(submission, null, 2)}\n`);
    assert.equal(submission.status, 'Accepted', `Apple did not accept submission ${submission.id}`);
    await run('/usr/bin/xcrun', ['stapler', 'staple', dmgPath]);
    await run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath]);
    await run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmgPath]);
  }
  const digest = createHash('sha256').update(await fs.readFile(dmgPath)).digest('hex');
  await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${digest}  ${filename}\n`);
  await fs.writeFile(path.join(output, 'release.json'), `${JSON.stringify({
    version, sourceRevision: revision.trim(), sourceDirty: Boolean(dirty.trim()),
    architectures: ['x86_64', 'arm64'], signed, notarized: signed, filename, sha256: digest,
  }, null, 2)}\n`);
  await fs.rm(imageContents, { recursive: true });
  console.log(`${signed ? 'Signed and notarized release' : 'UNSIGNED PACKAGING PREVIEW'}: ${dmgPath}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
