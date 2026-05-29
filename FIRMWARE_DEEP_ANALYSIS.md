# Launchpad X v2.0.1 — Deep firmware analysis & screen records

A thorough reverse-engineering pass over the Launchpad X v2.0.1 firmware
(`launchpadx-firmware-422.syx`), going beyond the palette map in
[COLOR_PALETTE_USAGE.md](./COLOR_PALETTE_USAGE.md) /
[SCREEN_COLOR_MAP.md](./SCREEN_COLOR_MAP.md): the LED model, the **built-in
bitmap font**, the **text screens** the device draws, and per-screen records.

- Decoded raw image: 80,433 bytes, SHA-256 `9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e`
- Real load base `0x0800C000` (app region after the bootloader); file offset = runtime − base.
- Tools (tracked, runnable on a fresh checkout): `tools/decode-firmware.mjs`, `tools/find-palette-refs.mjs`, `tools/render-text.mjs`.
- Legend — **[FW]** traced from disassembly · **[Man]** Novation manual · **[Corr]** FW↔manual correlation.

---

## 1. Image memory map (data tables)

| Region | File offset | Runtime | Size | Contents |
| --- | --- | --- | --- | --- |
| Vector table | `0x00000` | `0x0800C000` | — | initial SP `0x2000FFF8`, reset `0x0801F478` |
| Note colour table | `0x0D126` | `0x08019126` | 4 immediates | root `0x5e` / scale `0x24` / off `0x00` / accent `0x15` [FW] |
| RGB palette | `0x12034` | `0x0801E034` | 128×4 (`B,G,R,0`) | the 128-colour palette |
| **Font glyph columns** | `0x12234` | `0x0801E234` | variable | 1 byte/column, 8px tall, bit7 = top |
| Tab triplet (unused) | `0x12974` | `0x0801E974` | `01 24 34`× | data only, **no code reference** [FW] |
| **Font offset table** | `0x12A04` | `0x0801EA04` | 96×u16 | per-char start offset into glyph columns |
| **Font width table** | `0x13174` | `0x0801F174` | 96×u8 | per-char width (`& 0x3f`) |

Source modules (from `__FILE__` assert strings): `padsmods.c`, `io_listener.c`,
`layout_devconf.c`, `layout_channel.c`, `note_conf.c`, `midiobj_backend.c`,
`confsys*.c`, `extdata_*.c`, `serstor_hw.c`.

---

## 2. LED model [FW]

- **Internal index**: `set_led(led, …)` uses a 10×10 grid index `row*10 + col`,
  `led < 100` (top-down: row0 = top control row, col9 = right column).
- **Primitives**: `0x800F236` `set_led(led, colourWord)` (writes the BGR word into the
  framebuffer) · `0x800F254` lighting mode (static/flash/pulse) · `0x800F242` flag bits.
- **Palette → RGB**: the core pad renderer `0x800FD0E` (`~0x800FA02`) reads each pad's
  palette index from RAM and looks up `palette[index]` (`ldr.w r9,[r0,r1,lsl#2]`).
- **MIDI numbering** (Programmer layout; same LED index for all layouts) [Man]:
  8×8 grid `11..88` (bottom-left=11, top-right=88), top row CC `91..98`
  (↑↓←→ / Session / Note / Custom / Capture MIDI), right scene column CC `19..89`,
  logo `99`. Channels: 1=static, 2=flash, 3=pulse.

---

## 3. Built-in bitmap font — text screens [FW]

The device renders text (Settings labels, scrolling messages) with a built-in
**proportional 8px font**.

- `0x800EF58` `draw_char(ascii)` — supports ASCII 32–127 (96 glyphs).
  - per-char start offset = `u16[0x0801EA04 + (c-32)*2]` into the glyph column data,
  - per-char width = `u8[0x0801F174 + (c-32)] & 0x3f`,
  - glyph = `width` consecutive bytes from `0x0801E234 + offset`; each byte is one
    column, **bit7 = top row → bit0 = bottom row** (8px tall).
- `0x800F002` `draw_string(ptr)` — draws a NUL-terminated ASCII string char by char.

Reproduce any text screen:

```powershell
node tools/render-text.mjs work\firmware.bin "NOTE"
```

### Settings page labels (`0x800F002` callers in the settings renderer `0x80158D4`)

```
"LED"              "VEL"              "AFT"              "FAD"
#....#####.###...  #...#.#####.#....  ..#...#####.#####. #####...#...###...
#....#.....#..#..  #...#.#.....#....  ..#...#.......#... #.......#...#..#..
#....#.....#...#.  #...#.#.....#....  .#.#..#.......#... #......#.#..#...#.
#....####..#...#.  .#.#..####..#....  .#.#..####....#... ####...#.#..#...#.
#....#.....#...#.  .#.#..#.....#....  .###..#.......#... #......###..#...#.
#....#.....#..#..  ..#...#.....#....  #...#.#.......#... #.....#...#.#..#..
####.#####.###...  ..#...#####.####.  #...#.#.......#... #.....#...#.###...
```

### Mode-switch scrolling messages (strings `0x8015BF4`/`0x8015BFC`/`0x8015C08`)

Pressing the green / orange scene button in Settings scrolls these across the grid:

```
"Live"             "Programmer"  (g/m descend below the baseline)   "Legacy"
#....#...........  ####.............................................. #.............
#................  #...#............................................. #.............
#....#..#...#..##. #...#.#.#..##...###.#.#..##..##.#..##.#...##..#.#.  #.....##...###..##...###.#..#.
#....#..#...#.#..# ####..##..#..#.#..#.##.....#.#.#.#.#.#.#.#..#.##..  #....#..#.#..#....#.#....#..#.
#....#...#.#..#### #.....#...#..#.#..#.#....###.#.#.#.#.#.#.####.#...  #....####.#..#..###.#....#..#.
#....#...#.#..#... #.....#...#..#..###.#...#..#.#.#.#.#.#.#.#....#...  #....#.....###.#..#.#.....###.
####..#...#....### #.....#....##.....#.#....###.#.#.#.#.#.#..###.#...  ####..###....#..###..###....#.
```

(Generated from the firmware font; `tools/render-text.mjs` reproduces any string.)

---

## 4. Screen-by-screen records

### Session mode [Man/FW]
8×8 = DAW session clips; colours come from the host over MIDI (Ch1/2/3 =
static/flash/pulse). No fixed firmware colours — host index → RAM → core renderer
`0x800FD0E`. Right column = scene launch.

### Note mode [FW] — default 8×8 (R=root `0x5e`, s=scale `0x24`, .=off `0x00`; press→accent `0x15`)

```
 s R . s . s s .
 . s . s . s R .
 . s . s s . s .
 . s . s R . s .
 . s s . s . s .
 . s R . s . s s
 s . s . s . s R
 R . s . s s . s
```
Layout `pitch = col + (7-row)*5` (rows offset by a 4th). Colours are the four
immediates at `0x08019126`. Top row = octave/transpose + mode tabs; right = scene.

### Custom 1–4 [Man]
Custom 1/2 = 8×8 Note On (factory Drum-Rack layout); Custom 3/4 = Lighting
(unlit by default, host Notes light pads). Colours host-driven via `0x800FD0E`.
"Ghost mode" (Note+Custom in quick succession) unlights the edge buttons.

### Programmer mode [Man/FW]
Full 9×9 sends independent Note/CC; unlit at power-on. Host lights pads by
velocity=colour-index; the receive handler `0x801CCCC` (`~0x801CB1E`) looks up
`palette[index]` with a host-supplied index.

### Octave / transpose indicator (↑↓←→) [FW]
`0x8018D74` blends a 2-colour gradient by transpose amount:
A = `0x5e`→`0x5f`, B = `0x24`→`0x2d` (`add palette,#0x178`/`#0x90`; `+4`/`+0x24`).

### Top mode row + right scene column [FW]
`0x801523C`: off `0x00`, idle `0x01`, selected/lit `0x1C`; current-mode colour is
variable. (Earlier `0x24`/`0x34` "tab" candidate is **not** used — see §1 triplet.)

### Settings menu (hold Session) [Man/Corr] — renderer `0x80158D4`
Four pages via the top scene buttons; labels drawn with the font (§3):

| Page | Pads | State colours |
| --- | --- | --- |
| **LED** | brightness slider (8), LED feedback internal/external, LED sleep | selected=bright white `0x03`, on=green `0x15`, off=dim red `0x07` |
| **VEL** | enable + 3 curves | on=green `0x15`/off=red `0x07`; selected curve=orange `0x09`, others=dim white `0x01` |
| **AFT** | off/channel/poly + 3 thresholds | selected bright; threshold=purple `0x35`, others=dim white `0x01` |
| **FAD** | fader velocity on/off | green `0x15` / red `0x07` |
| mode switch | green scene = Live, orange scene = Programmer | scrolls "Live"/"Programmer"/"Legacy" (§3) |

---

## 5. Palette record (all 128 entries, `#RRGGBB`)

```
0x00 #000000  0x01 #3c3c3c  0x02 #7c7c7c  0x03 #fcfcfc  0x04 #fc3c3c  0x05 #fc0000  0x06 #7c0000  0x07 #3c0000
0x08 #fcbc6c  0x09 #fc3c00  0x0a #7c1c00  0x0b #3c0c00  0x0c #fcac2c  0x0d #fcfc00  0x0e #7c7c00  0x0f #3c3c00
0x10 #7cfc2c  0x11 #4cfc00  0x12 #2c7c00  0x13 #143c00  0x14 #4cfc3c  0x15 #00fc00  0x16 #007c00  0x17 #003c00
0x18 #4cfc4c  0x19 #00fc1c  0x1a #007c0c  0x1b #003c04  0x1c #4cfc5c  0x1d #00fc5c  0x1e #007c2c  0x1f #003c14
0x20 #4cfcbc  0x21 #00fc9c  0x22 #007c4c  0x23 #003c24  0x24 #4cbcfc  0x25 #00acfc  0x26 #00547c  0x27 #002c3c
0x28 #4c7cfc  0x29 #0054fc  0x2a #002c7c  0x2b #00143c  0x2c #2c1cfc  0x2d #0000fc  0x2e #00007c  0x2f #00003c
0x30 #5c3cfc  0x31 #2c00fc  0x32 #14007c  0x33 #0c003c  0x34 #fc3cfc  0x35 #fc00fc  0x36 #7c007c  0x37 #3c003c
0x38 #fc3c6c  0x39 #fc004c  0x3a #7c002c  0x3b #3c001c  0x3c #fc0c00  0x3d #9c3c00  0x3e #7c4c00  0x3f #2c2c00
0x40 #003c00  0x41 #003c1c  0x42 #001c6c  0x43 #0000fc  0x44 #003c3c  0x45 #1c00bc  0x46 #5c3c4c  0x47 #1c0c14
0x48 #fc0000  0x49 #bcfc2c  0x4a #acec00  0x4b #5cfc00  0x4c #0c7c00  0x4d #00fc5c  0x4e #009cfc  0x4f #002cfc
0x50 #1c00fc  0x51 #5c00ec  0x52 #ac1c7c  0x53 #2c0c00  0x54 #fc2c00  0x55 #7cdc00  0x56 #6cfc1c  0x57 #00fc00
0x58 #3cfc2c  0x59 #5cec6c  0x5a #3cfccc  0x5b #5c8cfc  0x5c #2c4ccc  0x5d #6c4cdc  0x5e #dc1cfc  0x5f #fc005c
0x60 #fc4c00  0x61 #bcac00  0x62 #8cfc00  0x63 #7c5c00  0x64 #3c2c00  0x65 #00440c  0x66 #0c4c1c  0x67 #14142c
0x68 #141c5c  0x69 #5c3414  0x6a #7c0000  0x6b #dc3c2c  0x6c #dc440c  0x6d #fcbc1c  0x6e #9cdc2c  0x6f #6cac0c
0x70 #14142c  0x71 #dcdc6c  0x72 #7cec8c  0x73 #9c9cfc  0x74 #8c6cfc  0x75 #3c3c3c  0x76 #6c6c6c  0x77 #dcfcfc
0x78 #9c0000  0x79 #340000  0x7a #14cc00  0x7b #003c00  0x7c #bcac00  0x7d #3c2c00  0x7e #ac4c00  0x7f #4c0c00
```

---

## 6. Palette-reader sites recap

8 literal-pool references to `0x0801E034` = the 8 code paths that colour the surface:
core pad renderer `0x800FD0E`; Note table `0x08019126`; transpose indicator
`0x8018D74`; transpose alt-state `0x8016408`; top row + scene `0x801523C`; settings
buttons `0x80158D4` + `0x8015C86`/`0x8015D36`; host (SysEx/MIDI) lighting `0x801CCCC`.
See `COLOR_PALETTE_USAGE.md` for the per-site index lists.

---

## Reproduce

```powershell
node tools/decode-firmware.mjs "C:\path\to\launchpadx-firmware-422.syx" work\firmware.bin
arm-none-eabi-objdump -D -b binary -m arm -M force-thumb --adjust-vma=0x0800C000 work\firmware.bin > work\fw.lst
node tools/find-palette-refs.mjs work\firmware.bin     # palette reader sites
node tools/render-text.mjs work\firmware.bin "LED"     # render any text screen
```

`work/` (bin, listings) stays gitignored; scripts in `tools/` are tracked.

## Sources
- Novation, *Launchpad X — Programmer's Reference Manual* / *User Guide v2.0*.
- Firmware disassembly via `arm-none-eabi-objdump`.
