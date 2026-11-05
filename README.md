# Blackbox Stick Overlay

Standalone **Windows application** for creating animated Mode 2 stick overlays from Betaflight Blackbox logs for **DaVinci Resolve Free or Studio**.

## Current status: 0.5 build candidate

- Select a \`.BBL\`, \`.BFL\` or decoded CSV file.
- Decodes original Blackbox files internally via Betaflight's official \`blackbox_decode\` tool.
- Choose flight number, video FPS and a starting offset.
- Generate transparent PNG frames showing yaw/throttle and roll/pitch.
- Import the PNG sequence into Resolve as an image sequence on a video track above your FPV footage.
- Move the overlay clip along the timeline to synchronise it manually.

**This is not yet a native Fusion/OpenFX plugin.** The result is a transparent image sequence; live Fusion controls and automatic sync are future work.

## Download for Windows

Go to [Actions](https://github.com/alfonsogordon/Blackbox-Stick-Overlay/actions/workflows/windows-build.yml), select the latest successful **Windows standalone build**, and download the \`BlackboxStickOverlay-Windows\` artifact. Extract the ZIP and run \`BlackboxStickOverlay.exe\`. **No Python installation is required on the editing PC.** GitHub Actions compiles the decoder and packages the Python runtime with PyInstaller on its own Windows runner.

Do not launch until the build has a green success indicator. This initial workflow has not been end-to-end verified yet.

## How to use in DaVinci Resolve

1. Import the transparent \`sticks_000000.png\` sequence from the generated folder. Set image-sequence import if Resolve presents individual stills.
2. Put the image sequence on V2 above the flight video on V1.
3. Adjust its Transform position/scale in the Inspector.
4. Slide the stick-overlay clip in time to match the video. For accurate sync, identify a distinctive roll/yaw/throttle movement in both sources.

The input's original .BBL does **not** need to be published to GitHub. Keep your flight logs local.

## Limitations

- Flight data represents Betaflight's logged *processed RC commands*, rather than necessarily the radio's original raw stick calibration.
- The first prototype uses 800×300 PNG frames, and will require a lot of disk space for long recordings.
- Only Betaflight compatibility is being targeted and tested. No claimed Quicksilver/iNav support yet.
- The official decoder may change, and Windows executable/decoder integration requires validation with a real log.
- This is an open-source development prototype; not endorsed by Betaflight or Blackmagic Design.

## Build / development

The Windows GitHub workflow installs Python on a **GitHub-hosted runner only**, compiles the official decoder from source, then packages the app using PyInstaller. Its build stage does not rely on a GitHub release asset being available.

Decoder source: https://github.com/betaflight/blackbox-tools (GPLv3). See its license and retain required attribution when redistributing the bundled decoder.
