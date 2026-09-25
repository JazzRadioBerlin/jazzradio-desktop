# JazzRadio

A desktop player for [JazzRadio Berlin](https://jazzradio.net/), with a mini player, favorites and local notes. Built with Electron and TypeScript for macOS and Windows.

## Development

Install Node.js 24 and Git, then run:

```sh
npm ci
npm start
```

An internet connection is needed for playback, track information and artwork. No listener account is required.

## Checks

```sh
npm run typecheck
npm test
```

## Packaging

Build on the target operating system:

```sh
npm run package
```

Packages are written to `out/`. For an x64 Windows build, use `npm run package -- --platform=win32 --arch=x64` on Windows. Keep the complete Windows application folder together; the executable needs the accompanying files.

These commands produce unsigned development packages. Signing and release installers are separate steps.

## Rights and feedback

The application source is available for inspection; it is not offered under an open-source licence. JazzRadio names and artwork are not licensed for reuse. Third-party licences are preserved in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

Report problems to [info@jazzradio.net](mailto:info@jazzradio.net).
