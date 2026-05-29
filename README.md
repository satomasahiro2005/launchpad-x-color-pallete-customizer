# LaunchPad X Color Pallete Customizer

Minimal browser tool for editing Launchpad X firmware v2.0.1 color references.

This repository does not include Novation firmware binaries or SysEx files. Load
your own official v2.0.1 `.syx` or decoded `.bin` file in the browser, patch it
locally, then download or write the patched SysEx.

See [FIRMWARE_422.md](./FIRMWARE_422.md) for the exact binary offsets and patch
behavior.

## Acknowledgements

This project is inspired by
[mat1jaczyyy/LP-Firmware-Utility](https://github.com/mat1jaczyyy/LP-Firmware-Utility).
This app is a separate, minimal implementation focused on Launchpad X v2.0.1
palette and Note mode color patching.

## Firmware Source

Connect the Launchpad X in bootloader mode, open
[Novation Components](https://components.novationmusic.com/), start a firmware
reinstall, and inspect DevTools Network for the firmware URL.

The official URL usually looks like:

```text
https://circuit-librarian.s3.eu-west-1.amazonaws.com/uploads/firmware/file/147/launchpadx-firmware-422.syx
```

Download that file yourself and load it with `Read firmware file`.

## Run

```powershell
npm start
```

Open:

```text
http://127.0.0.1:4174/
```
