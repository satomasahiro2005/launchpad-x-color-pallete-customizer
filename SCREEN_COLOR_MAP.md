# Launchpad X 4.2.2 — Per-screen grid & colour edit points

Purpose: groundwork for a **future editor that lets you walk through every
Launchpad screen and change which palette number each colour points to**. For
each screen (mode / settings) this lists "what is assigned to the grid" and
"where the colour is stored in firmware / whether it is editable".

- Firmware-analysis details, real base (`0x0800C000`) and palette location
  (`0x0801E034`) are in [COLOR_PALETTE_USAGE.md](./COLOR_PALETTE_USAGE.md).
- Source legend — **[FW]** confirmed by disassembly / **[Man]** Novation official
  manual / **[Corr]** correlation of FW colours with the manual (high-confidence inference).

---

## 0. Common: grid coordinates and LED numbers

Physically a **9×9 (8×8 pads + top function row + right scene column + logo)**.

### MIDI numbers (Programmer-mode basis; the LED index is shared by all layouts) [Man]

```
        (top = CC, row9)   91   92   93   94   95   96   97   98   <- ↑ ↓ ← → / Session / Note / Custom / Capture
                        ┌────────────────────────────────────┐
   row8 (top)           │ 81  82  83  84  85  86  87  88       │ 89   ┐
   row7                 │ 71 ...                          78   │ 79   │
   ...                  │                                      │ ...  │ right Scene Launch (CC, col9)
   row1 (bottom)        │ 11  12  13  14  15  16  17  18       │ 19   ┘
                        └────────────────────────────────────┘
        bottom-left=11, bottom-right=18, top-left=81, top-right=88,  Logo=99
```

- Top function buttons (CC): `91`=↑ `92`=↓ `93`=← `94`=→ `95`=Session `96`=Note `97`=Custom `98`=Capture MIDI
- Right scene column (CC, bottom→top): `19 29 39 49 59 69 79 89`
- Lighting channels: Ch1=static / Ch2=flash / Ch3=pulse [Man]

> ⚠️ The **firmware-internal index is a different scheme** (`row*10+col` but with
> row0=top, top-down, 0..99). A conversion table between the MIDI numbers and the
> internal index will be needed when building the editor. [FW]

---

## 1. Note mode

**Grid assignment** [Man/FW]: 8×8 are scale pads. This app's `getGridPitch =
col + (7-row)*5` (the standard layout where each row shifts by a perfect fourth =
5 semitones). Pressing sends MIDI Note On; velocity = strike force. Top row =
mode/transpose, right column = scenes.

**Colours used (edit points)**:

| Role | Palette idx (default) | Storage (file offset) | Storage form | Editable |
| --- | --- | --- | --- | --- |
| Root | `0x5E` | `0x0D126` | `movs` immediate | ✓ already editable in the app |
| Scale | `0x24` | `0x0D128` | `movs` immediate | ✓ |
| Off (out of scale) | `0x00` | `0x0D12E` | `movs` immediate | ✓ |
| Accent (press / hard hit) | `0x15` | `0x0D130` | `movs` immediate | ✓ |

These are written into RAM pad state and coloured by the common renderer
`0x800FD0E` via `palette[idx]`. [FW confirmed]

---

## 2. Top "↑ ↓ ← →" = octave / transpose indicator

**Assignment**: left two = octave ±, right two = transpose (length shown as a
colour gradient via `udiv` interpolation). [FW]

**Colours used (edit points)** — render function `0x8018D74`:

| Role | idx | Storage | Form | Note |
| --- | --- | --- | --- | --- |
| Set A base | `0x5E` | `0xCDBA` (`add.w r,palette,#0x178`) | address immediate (= idx×4) | `0x178/4 = 0x5E` |
| Set A 2nd | `0x5F` | `0xCE86` (`ldr [r,#4]`) | ldr offset | `+4` = next idx |
| Set B base | `0x24` | `0xCE14` (`add.w r,palette,#0x90`) | address immediate | `0x90/4 = 0x24` |
| Set B 2nd | **`0x2D`** | `0xCE30` (`ldr [r,#0x24]`) | ldr offset | 0x90+0x24=0xB4 → idx `0x2D` (the existing doc's `0x25` is wrong) |
| Alt display (state2) lit/off | `0x0D` / `0x00` | `0xA40A` / `0xA40C` (`ldr [palette,#imm]`) | ldr offset | separate function `0x8016408` |

> Edit mechanism: changing the **immediate (idx×4 or ×1)** of the `add.w`/`ldr`
> changes the referenced idx. But `add.w` uses Thumb-2 modified-immediate
> encoding, so arbitrary idx values need re-encoding. To change only the RGB,
> editing the palette entry for that idx is the safe route.

---

## 3. Top "Session / Note / Custom / Capture" + right scene column

**Assignment** [Man]: the four top-right buttons switch mode; the right column
launches scenes / selects settings pages.

**Colours used (edit points)** — near render `0x801523C`:

| Role | idx | Storage | Form |
| --- | --- | --- | --- |
| Off / unselected | `0x00` | `0x924A` (`ldr [palette,#0]`) | ldr |
| Idle (dim grey) | `0x01` | `0x9252` (`ldr.w [palette,#4]`) | ldr.w |
| Selected / lit (bright green) | `0x1C` | `0x9266` (`ldr [palette,#0x70]`) | ldr |
| Auxiliary (dim red) | `0x07` | `0x931C` (`add.w palette,#0x1C`) | address immediate |
| Current-mode colour | variable | `0x9246` (`ldr.w [palette, idx<<2]`) | table/RAM driven |

---

## 4. Settings menu — hold Session to enter

Enter by briefly holding `Session`. The top 4 rows display the text "LED / VEL /
AFT / FAD"; the top 4 Scene Launch buttons switch pages. [Man]
Text is drawn by `0x800F002` (lights NUL-terminated pad bitmaps one at a time). [FW]

**Pages and per-pad assignment** [Man]:

| Page (Scene) | Pad contents | State colours (manual wording) |
| --- | --- | --- |
| **LED** | brightness slider (8 levels) / LED feedback (internal) / LED feedback (external) / LED sleep | selected level = **bright white**, enabled = **bright green**, disabled = **dim red** |
| **VEL** | velocity ON/OFF / 3 curves (Low/Med/High) | enabled = **bright green** / disabled = **dim red**, selected curve = **bright orange**, others = **dim white** |
| **AFT** | Off / Channel Pressure / Poly + 3 thresholds | selected = **bright**, selected threshold = **bright purple**, others = **dim white** |
| **FAD** | fader velocity sensitivity ON/OFF | enabled = **bright green** / disabled = **dim red** |
| (shared) | Live = green Scene / Programmer = orange Scene | Live = **green**, Programmer = **orange** |

**Colour edit points** [Corr] — Settings render cluster `0x80158D4`:

| Manual colour | Palette idx | Real RGB | Storage | Form |
| --- | --- | --- | --- | --- |
| Bright green (enabled / Live) | `0x15` | `#00fc00` | `0x98FC` (`ldr [palette,#0x54]`) | ldr |
| Bright orange (VEL curve / Programmer) | `0x09` | `#fc3c00` | `0x991E` (`ldr [palette,#0x24]`) | ldr |
| Bright purple (AFT threshold) | `0x35` | `#fc00fc` | `0x993E` (`ldr.w [palette,#0xD4]`) | ldr.w |
| Dim red (disabled) | `0x07` | `#3c0000` | (various `ldr`/`add.w`) | ldr |
| Dim white (unselected) | `0x01` | `#3c3c3c` | (various) | ldr |
| Bright white (brightness selected level) | `0x03` | `#fcfcfc` | (LED page) | — |

> ✅ The main Settings colours (green/orange/purple) match the `ldr [palette,#…]`
> immediates in `0x80158D4` and the manual wording → this cluster is the Settings
> menu renderer (`0x800F002` also draws the "LED/VEL/AFT/FAD" text).

---

## 5. Session mode

**Assignment** [Man]: the 8×8 is DAW (Ableton etc.) session clips. Colours are
sent from the DAW over MIDI (Ch1 static / Ch2 flash / Ch3 pulse) and are **not
fixed in firmware**. Right column = scene launch.

**Colour source**: host-sent index → RAM pad state → common renderer `0x800FD0E`.
**No fixed edit point** (colour is host-dependent). [FW structural]

---

## 6. Custom modes (1–4)

**Assignment** [Man]:
- Custom 1: 8×8 Note On (factory = Drum Rack layout)
- Custom 2: 8×8 Note On
- Custom 3: Lighting (Drum Rack layout) — unlit by default, host Notes light pads
- Custom 4: Lighting (Session layout)
- Ghost mode: pressing Note→Custom in quick succession unlights the edge buttons

**Colour source**: Lighting modes use a host-supplied index; built-in feedback
follows the LED-feedback (internal) setting. Not a fixed colour table — **variable**
(via `0x800FD0E`). [FW structural]

---

## 7. Programmer mode

**Assignment** [Man]: the full 9×9 sends independent Note/CC (numbers in §0).
Everything is unlit at power-on. Pad lighting is fully host-controlled via MIDI
(Note/CC + velocity = colour index).

**Colour source**: the host specifies a colour index (0–127) in velocity → used
directly as `palette[index]`. The receive handler `0x801CCCC` (`~0x801CB1E`) reads
the palette with a variable index. **No fixed edit point** (colour is host-dependent,
but editing the palette entries at `0x0801E034` changes how every index looks). [FW]

---

## 8. Summary for the future editor: two edit strategies

1. **Edit palette RGB** (the existing app's approach): rewrite the BGR at
   `0x0801E034 + idx*4`. On any screen, the colour of the **idx that screen uses**
   changes. Works even for host-driven screens (Session/Custom/Programmer).
   → Group "the idx set each screen uses" from the tables in this doc and lay out
   swatches per screen. **Recommended and safest.**

2. **Re-point the referenced index** (change which slot is read):
   - `movs` immediate (Note table): can be set to any idx. ✓
   - `ldr [palette,#imm]`: imm = idx×4. idx<32 fits a `ldr` (imm5×4), but larger
     values or `ldr.w`/`add.w` are constrained / need re-encoding. △
   - Host/RAM driven (Session/Custom/Programmer/current-mode colour): not statically
     patchable. ✗

> Each screen's "fixed colours" are collected in §1–§4. §5–§7 are host-dependent,
> so only strategy 1 applies.

---

## Sources

- Novation, *Launchpad X — Programmer's Reference Manual*
  https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Launchpad%20X%20-%20Programmers%20Reference%20Manual.pdf
- Novation, *Launchpad X — User Guide v2.0*
  https://files.kraftmusic.com/media/ownersmanual/Novation_Launchpad_X_User_Guide.pdf
- Firmware analysis: `launchpadx-firmware-422.syx` (repro steps in `COLOR_PALETTE_USAGE.md`, scripts in `tools/`)
