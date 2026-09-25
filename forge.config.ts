import path from 'node:path';
import { chmodSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerPKG } from '@electron-forge/maker-pkg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Store and direct distribution are separate opt-in signing paths.
const masMode = process.env.JAZZRADIO_MAS;
if (masMode && !['unsigned', 'development', 'distribution'].includes(masMode)) {
  throw new Error('JAZZRADIO_MAS must be unsigned, development or distribution');
}
const signedMAS = masMode === 'development' || masMode === 'distribution';
const directMode = process.env.JAZZRADIO_DIRECT;
if (directMode && !['unsigned', 'distribution'].includes(directMode)) {
  throw new Error('JAZZRADIO_DIRECT must be unsigned or distribution');
}
if (masMode && directMode) throw new Error('Choose either MAS or direct distribution');
const signedDirect = directMode === 'distribution';
function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Set ${name} locally before signing`);
  return value;
}
const buildVersion = process.env.JAZZRADIO_BUILD_NUMBER ?? '1';
if (!/^[1-9]\d*$/.test(buildVersion)) throw new Error('Build number must be a positive integer');
const profile = signedMAS ? required('JAZZRADIO_MAS_PROFILE') : undefined;
if (profile && !path.isAbsolute(profile)) throw new Error('JAZZRADIO_MAS_PROFILE must be an absolute local path');
const developerIdentity = signedDirect ? required('JAZZRADIO_DEVELOPER_ID_IDENTITY') : undefined;
if (developerIdentity && !/^Developer ID Application: .+ \(2MHNF9468Q\)$/.test(developerIdentity)) {
  throw new Error('Direct distribution requires JazzRadio\'s Developer ID Application identity');
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [path.resolve(__dirname, 'THIRD_PARTY_NOTICES.txt')],
    afterExtract: [(buildPath, _version, platform, _arch, callback) => {
      if (platform !== 'darwin' && platform !== 'mas') {
        callback();
        return;
      }
      // A DMG or App Store install carries the .app, not its sibling licence files.
      const resources = path.join(buildPath, 'Electron.app', 'Contents', 'Resources');
      void Promise.all(['LICENSE', 'LICENSES.chromium.html'].map((filename) =>
        copyFile(path.join(buildPath, filename), path.join(resources, filename)),
      )).then(() => callback(), callback);
    }],
    // Packager selects .icns for macOS/MAS and .ico for Windows.
    icon: path.resolve(__dirname, 'assets/app'),
    buildVersion,
    ...(masMode || directMode ? {
      electronVersion: '44.4.5',
      osxUniversal: { mergeASARs: true },
      extendInfo: { ElectronTeamID: '2MHNF9468Q' },
    } : {}),
    ...(signedMAS ? {
      osxSign: {
        type: masMode as 'development' | 'distribution',
        identity: required('JAZZRADIO_MAS_APP_IDENTITY'),
        provisioningProfile: profile,
        preAutoEntitlements: false,
        // Packager 18.4.4 handles this at runtime but omits it from its macOS type.
        ...{ continueOnError: false },
        optionsForFile: (filePath: string) => {
          const nested = filePath.includes('.app/');
          if (!nested) {
            // osx-sign has embedded the profile before this pre-sign callback.
            // This shipped copy must be publicly readable for installation;
            // the private source profile keeps its owner-only permissions.
            chmodSync(path.join(filePath, 'Contents', 'embedded.provisionprofile'), 0o644);
          }
          return {
            hardenedRuntime: false,
            entitlements: path.resolve(__dirname, nested
              ? 'build/entitlements.mas.inherit.plist'
              : 'build/entitlements.mas.plist'),
          };
        },
      },
    } : {}),
    ...(signedDirect ? {
      osxSign: {
        type: 'distribution' as const,
        identity: developerIdentity,
        preAutoEntitlements: false,
        preEmbedProvisioningProfile: false,
        ...{ continueOnError: false },
        optionsForFile: () => ({
          hardenedRuntime: true,
          entitlements: path.resolve(__dirname, 'build/entitlements.direct.plist'),
        }),
      },
    } : {}),
    appBundleId: 'org.jazzradio.JazzRadio',
    name: 'JazzRadio',
    appCategoryType: 'public.app-category.music',
    win32metadata: {
      CompanyName: 'JazzRadio',
      FileDescription: 'JazzRadio',
      ProductName: 'JazzRadio',
      InternalName: 'JazzRadio',
      OriginalFilename: 'JazzRadio.exe',
    },
  },
  hooks: {
    prePackage: async (_config, platform) => {
      if (Number(process.versions.node.split('.')[0]) !== 24) {
        throw new Error('Packaging requires Node 24 LTS; Node 26 exits during ZIP extraction with this toolchain');
      }
      if ((platform === 'mas') !== Boolean(masMode)) {
        throw new Error('Use the package:mas:* or make:mas scripts for MAS; unset JAZZRADIO_MAS for ordinary builds');
      }
      if (directMode && platform !== 'darwin') {
        throw new Error('Direct macOS distribution requires the darwin platform');
      }
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin']),
    ...(masMode === 'distribution'
      ? [new MakerPKG({ identity: required('JAZZRADIO_MAS_INSTALLER_IDENTITY') }, ['mas'])]
      : []),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      // Sign only after merging: arm64-only signature files prevent merging.
      ...(masMode || directMode ? { resetAdHocDarwinSignature: false } : {}),
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
