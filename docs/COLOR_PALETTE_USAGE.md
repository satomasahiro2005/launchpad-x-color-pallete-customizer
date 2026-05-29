# Launchpad X v2.0.1 — Palette usage by screen (firmware analysis)

Disassembly of the Launchpad X v2.0.1 firmware (`launchpadx-firmware-422.syx`) to
map **which screen (mode / surface) uses which index of the 128-colour palette,
and where**. (The firmware package file is labelled `422`; the device application
version is **v2.0.1**.)

- Input SysEx: `launchpadx-firmware-422.syx` (110,661 bytes)
- Decoded raw image: 80,433 bytes / SHA-256 `9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e`
  (= the official v2.0.1 image; matches the hash recorded in `FIRMWARE_422.md`)
- Disassembler: `arm-none-eabi-objdump` (ARM Cortex-M / Thumb)
- Reproduce with the tracked scripts in `tools/` (see the end of this doc). Raw
  images and disassembly listings live in `work/`, which is gitignored.

> Confidence legend — **Confirmed**: traced to the instruction level.
> **Strong**: data/reference verified, final render path partly untraced.
> **Public**: filled in from Novation's official manuals.

---

## 0. Key correction: the real load base is `0x0800C000`

`FIRMWARE_422.md` records addresses as **file offsets (cosmetic base `0x08000000`)**.
From the vector table (reset vector `0x0801F478`, lowest code pointer `0x0800C32F`)
and literal-pool analysis, the **actual load base of this image is `0x0800C000`**
(the application region after a 48 KB bootloader).

| Item | File offset | Runtime address (base `0x0800C000`) |
| --- | --- | --- |
| RGB palette start | `0x12034` | **`0x0801E034`** |
| Note colour table | `0x0D126` | **`0x08019126`** |
| Tab three-state table (candidate) | `0x12974` | `0x0801E974` |

> Only with this real base do literal pools pointing at the palette start
> `0x0801E034` appear — **8 of them** (zero under base `0x08000000`). Those 8 are
> "the code paths that read the palette" and are the focus of this analysis.

---

## 1. Palette layout (recap)

- 128 colours × 4 bytes = `B, G, R, 0x00` (channels `0..63`, stored `<<2` in firmware)
- Lives at `0x0801E034` .. `0x0801E234`
- Palette → RGB → physical LED conversion is done by the **core render function
  `0x800FD0E`** (function head `~0x800FA02`):
  ```
  800fd0e: ldr   r0, [pc]            ; r0 = 0x0801E034 (palette base)
  800fd10: ldrb  r1, [r7, #13]       ; r1 = this pad's palette index (RAM pad state)
  800fd12: ldr.w r9, [r0, r1,lsl#2]  ; r9 = palette[index] BGR word
  ```
- LED write primitives:
  - `0x800F236` … `set_led(led, colorWord)` (writes a raw colour word directly into
    the 10×10 internal buffer, `led < 100`)
  - `0x800F254` … LED lighting mode (static / flash / pulse)
  - `0x800F242` … LED flags (3-bit field)

### Internal LED index (0–99) vs physical layout

`set_led`'s `led` is not a MIDI note but a **10×10 internal coordinate `row*10 + col`**.

```
        col0   col1 .. col8   col9
row0    logo   [ 8 top control buttons ]   <- top function row
row1..8  -     [    8 × 8 pad grid    ]    col9 = right scene column
row9    -      [   bottom (unused)    ]    -
```

- `row0 col1–4` (LED 1–4) = **↑ ↓ ← → (octave / transpose arrows)**
- `row0 col5–8` (LED 5–8) = **Session / Note / Custom / Capture mode row**
- `row1–8 col1–8` (LED 11–88) = **8×8 pad grid**
- `col9` (LED 19,29,…,89) = **right scene / track column**

---

## 2. Palette usage map by surface / screen

The 8 palette-reading sites, analysed per function. RGB values are extracted from
this firmware's palette.

| Surface / screen | Render code (runtime addr) | Palette index used | Index colour (this firmware) | Confidence |
| --- | --- | --- | --- | --- |
| **Common pad renderer** (each mode writes an index into RAM pad state; coloured here) | `0x800FD0E` (`~0x800FA02`) | variable (any 0–127) | — | Confirmed |
| **Note mode 8×8 grid** | Note table `0x08019126` → common renderer | `0x5E` root / `0x24` scale / `0x00` off / `0x15` accent | purple `#dc1cfc` / cyan `#4cbcfc` / black / green `#00fc00` | Confirmed |
| **↑↓←→ octave / transpose indicator** | `0x8018D74` (loader `0x8018DA2`) | `0x5E`,`0x5F` (set A) / `0x24`,`0x2D` (set B) | purple `#dc1cfc`/pink `#fc005c` / cyan `#4cbcfc`/`0x2D` | **Confirmed** |
| ↑↓←→ alternate (state==2 simple display) | `0x801639A` / `0x8016408` | `0x00`,`0x0D` | black / yellow `#fcfc00` | Confirmed |
| **Top mode row + right scene column** | near `0x801523C` | `0x00` off / `0x01` dim grey / `0x1C` bright green + selected (variable) | black / `#3c3c3c` / `#4cfc5c` | Strong |
| **Round function buttons (mode-select feedback)** | near `0x80158D4` | `0x09`,`0x15`,`0x35` | orange `#fc3c00` / green `#00fc00` / magenta `#fc00fc` | Strong |
| ↳ related (button lighting) | `0x8015C86` / `0x8015D36` | `0x09`,`0x15`,`0x1C` + variable | same + bright green | Strong |
| **Host (SysEx/MIDI) pad lighting** Programmer / Custom Lighting | `0x801CCCC` (`~0x801CB1E`) | variable (host-supplied 0–127) | — | Strong |

---

## 3. Verification against the candidate table in `FIRMWARE_422.md`

| Existing doc claim | Result of this analysis |
| --- | --- |
| Note: root `0x5E` / scale `0x24` / off `0x00` / accent `0x15` | **Confirmed** (bytes `5e 24 00 15` at `0x08019126`) |
| Transpose A base `0x5E` / A blend `0x5F` / B base `0x24` / B blend `0x25` | **A confirmed (`5E`/`5F`), B base confirmed (`0x24`). But the second B colour is `0x2D` in the disassembly, not the doc's `0x25`.** `0x8018D74`: `add.w r4,palette,#0x178` (file `0xCDBA`, idx `0x5E`) → `[r4,#4]` (file `0xCE86`, idx `0x5F`); `add.w r6,palette,#0x90` (file `0xCE14`, idx `0x24`) → `[r6,#0x24]` (file `0xCE30`, idx **`0x2D`**). Index `0x25` is **never read anywhere** in the firmware. |
| Tab three-state `0x12974` = disabled `0x01` / idle `0x24` / selected `0x34` | **The data exists (`01 24 34` repeated) but no code reference literal was found** (consistent with `FIRMWARE_422.md`'s "render path untraced"). The actual top-button renderer (`0x801523C`) uses `0x01`/`0x1C` plus a variable selected colour; no path using `0x24`/`0x34` was found. |

> ⚠️ **Important overlap**: `0x24` (= Note scale AND Transpose B base) is shared by
> several surfaces. Rewriting that slot in the app moves the Note scale colour and
> transpose B together (same caveat as the existing doc).

---

## 4. Real RGB of the key palette indices (this firmware)

| index | #RGB | colour | main use |
| ---: | --- | --- | --- |
| `0x00` | `#000000` | black (off) | off-scale, unlit |
| `0x01` | `#3c3c3c` | dim grey | top / right-column idle |
| `0x09` | `#fc3c00` | orange | function buttons |
| `0x0D` | `#fcfc00` | yellow | transpose indicator (alt state) |
| `0x15` | `#00fc00` | green | **Note accent**, button lighting |
| `0x1C` | `#4cfc5c` | bright green | top / right-column selected/lit |
| `0x24` | `#4cbcfc` | cyan | **Note scale / Transpose B base** |
| `0x2D` | (see palette) | — | **Transpose B blend** (was wrongly `0x25` before) |
| `0x34` | `#fc3cfc` | magenta | tab "selected" candidate (unconfirmed) |
| `0x35` | `#fc00fc` | magenta | function buttons |
| `0x5E` | `#dc1cfc` | purple | **Note root / Transpose A base** |
| `0x5F` | `#fc005c` | pink | Transpose A blend |

---

## 5. Per-screen summary (screen names from public manuals)

Launchpad X screens (per the public manuals): **Session / Note / Custom 1–8 /
Programmer**, plus the top **↑↓←→ · Session · Note · Custom · Capture MIDI** buttons
and the right **scene column**. Confirmed palette usage:

- **Note mode (8×8)** — root `0x5E` / scale `0x24` / off `0x00` / accent (press) `0x15`.
  Defined by the 4 bytes at `0x08019126`, the exact bytes `FIRMWARE_422.md` patches. **(Confirmed)**
- **Octave / transpose arrows (↑↓←→)** — set A `0x5E`/`0x5F`, set B `0x24`/`0x2D`,
  drawn directly by `0x8018D74`. **(Confirmed)**
- **Top mode row / right scene column** — idle `0x01`, lit/selected `0x1C`, off `0x00`,
  current selection is a variable colour. **(Strong)**
- **Round function-button feedback** — `0x09`/`0x15`/`0x35`. **(Strong)**
- **Programmer / Custom host lighting (MIDI/SysEx)** — uses the host-supplied index directly. **(Strong)**
- **Session and Custom grid pad colours** — all go through RAM pad state and the
  common renderer `0x800FD0E`, so there is no dedicated fixed-index constant (the
  mode supplies the index). **(Confirmed structurally)**

---

## Reproduce

All scripts are tracked under `tools/` (they import the project's `firmware.js`).
A fresh checkout can run them directly:

```powershell
# 1) Decode SysEx -> raw image (reuses firmware.js); writes work/firmware.bin
node tools/decode-firmware.mjs "C:\path\to\launchpadx-firmware-422.syx" work\firmware.bin

# 2) Disassemble at the real base 0x0800C000
arm-none-eabi-objdump -D -b binary -m arm -M force-thumb --adjust-vma=0x0800C000 work\firmware.bin > work\fw.lst

# 3) List palette-reader sites and the constant indices each uses (with file offsets)
node tools/find-palette-refs.mjs work\firmware.bin
```

`work/` (binaries, `*.lst`) stays gitignored; the scripts in `tools/` are tracked.
