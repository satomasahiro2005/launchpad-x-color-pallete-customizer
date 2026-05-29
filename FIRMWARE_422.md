# Launchpad X Firmware v2.0.1 Notes

This document records what this app changes in the Launchpad X v2.0.1 firmware
image. It is intentionally offset-based and does not include any firmware bytes
or bundled firmware files.

## Scope

- Target device: Novation Launchpad X
- Target firmware: v2.0.1
- Firmware input: official `.syx` from Novation Components, or a decoded raw
  firmware image
- Firmware output: patched `.syx`
- Official v2.0.1 raw firmware SHA-256:

```text
9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e
```

The hash is calculated after decoding the SysEx into the inner raw firmware
image. It is not the hash of the `.syx` wrapper.

## Layout Guard

Before patching, the app checks fixed bytes that identify the expected v2.0.1
layout:

| Offset | Expected |
| --- | --- |
| `0x0d127` | `0x20` |
| `0x0d129` | `0x22` |
| `0x0d12f` | `0x20` |
| `0x0d131` | `0x22` |
| `0x12034` | `0x00` |
| `0x12035` | `0x00` |
| `0x12036` | `0x00` |
| `0x12037` | `0x00` |

If any byte differs, patching stops. This prevents writing v2.0.1 offsets into a
different firmware layout.

## Note Mode Color Table

The Note mode color references are stored as four immediate palette indices.
The app changes only these bytes for Note mode role assignment:

| Role | Offset | Stock index |
| --- | ---: | ---: |
| Root | `0x0d126` | `0x5e` |
| Scale | `0x0d128` | `0x24` |
| Off-scale | `0x0d12e` | `0x00` |
| Accent / pushed note | `0x0d130` | `0x15` |

Changing these bytes changes which palette entry each Note mode role uses. It
does not directly rewrite RGB values by itself.

Stock table:

```js
{ root: 0x5e, scale: 0x24, off: 0x00, accent: 0x15 }
```

Disassembly around the confirmed table:

```text
0800d126: 205e  movs r0, #94    ; 0x5e root
0800d128: 2224  movs r2, #36    ; 0x24 scale
0800d12a: 7408  strb r0, [r1, #16]
0800d12c: 744a  strb r2, [r1, #17]
0800d12e: 2000  movs r0, #0     ; 0x00 off-scale
0800d130: 2215  movs r2, #21    ; 0x15 pushed/accent
0800d132: 7488  strb r0, [r1, #18]
0800d134: 74ca  strb r2, [r1, #19]
```

## RGB Palette

The 128-color palette begins at:

```text
0x12034
```

Each palette entry is 4 bytes:

```text
B, G, R, 0x00
```

The UI uses RGB channels in `0..63`. Firmware bytes store those values shifted
left by 2:

```js
firmware[offset + 0] = blue << 2;
firmware[offset + 1] = green << 2;
firmware[offset + 2] = red << 2;
firmware[offset + 3] = 0x00;
```

Palette entry address:

```js
offset = 0x12034 + paletteIndex * 4;
```

## Extra Palette Slots Exposed by the UI

Verification status: traced from disassembly.

The mode/custom tab colours have now been traced to the top-row / scene-column
renderer (runtime `0x0801523C`, real base `0x0800C000`), which reads the palette
as:

- off / disabled    -> `0x00` (`ldr [palette, #0]`)
- idle / unselected -> `0x01` (`ldr.w [palette, #4]`)
- selected / lit    -> `0x1C` (`ldr [palette, #0x70]`, i.e. 0x70/4 = 0x1C)

The repeated triplet `01 24 34` at raw offset `0x12974` is **data only** — no
code reference to it was found, so it does **not** drive the tab colours. (The
earlier `0x1c` guess was correct after all; the `0x24`/`0x34` candidate was
wrong.) See `COLOR_PALETTE_USAGE.md` and `SCREEN_COLOR_MAP.md` for the full trace.

| UI target | Palette slot |
| --- | ---: |
| Tab disabled (off) | `0x00` |
| Tab idle / unselected | `0x01` |
| Tab selected / lit | `0x1c` |
| Transpose A base | `0x5e` |
| Transpose A blend | `0x5f` |
| Transpose B base | `0x24` |
| Transpose B blend | `0x2d` |

> These are the firmware's actual slots, traced from disassembly, and the values
> the app's Mode/Custom tab and transpose targets are aligned to in the current
> UI. An earlier build exposed the unverified `0x01 / 0x24 / 0x34` tab candidate
> instead; that has since been corrected.

When `Sync transpose color with note color` is enabled, export/write overwrites
only the transpose **base** slots from the selected Note colors; the blend slots
(`0x5f` / `0x2d`) are left untouched so the gradient is preserved:

```js
palette[0x5e] = palette[table.root];   // A base
palette[0x24] = palette[table.scale];  // B base
```

Current preview model:

| Preview state | Meaning | Binary confidence |
| --- | --- | --- |
| Disabled / off | Palette `0x00` | Confirmed |
| Idle | Palette `0x01` | Confirmed |
| Selected / lit | Palette `0x1c` | Confirmed |

Important overlap: palette slot `0x24` is also the stock Note scale color and
the Transpose B base slot. If the app writes slot `0x24`, those surfaces may
move together unless the actual Note table is changed to point at another
palette slot.

## Patch Process

1. Read a user-provided `.syx` or `.bin`.
2. Decode SysEx if needed.
3. Verify the v2.0.1 layout guard bytes.
4. Extract the current palette from `0x12034`.
5. Extract the Note table from `0x0d126`, `0x0d128`, `0x0d12e`,
   and `0x0d130`.
6. Apply selected palette and table changes to a copy of the firmware image.
7. Rebuild a Novation SysEx firmware file.

## SysEx Wrapper

The app decodes and rebuilds the Novation firmware SysEx wrapper.

Known values:

| Field | Value |
| --- | ---: |
| Manufacturer header | `f0 00 20 29 00` |
| Family ID | `0x02` |
| Product ID | `0x0c` |
| Version digits (raw SysEx field) | `0x04 0x02 0x02` |

Message commands used:

| Command | Meaning in this app |
| --- | --- |
| `0x71` | Version/start message |
| `0x7c` | Metadata message containing version, raw size, and CRC |
| `0x72` | Firmware data block |
| `0x73` | Firmware block zero / final block message |

Raw firmware is split into 256-bit blocks:

```text
256 bits = 32 raw bytes
```

Each block is packed into 7-bit-safe SysEx bytes:

```text
ceil(256 / 7) = 37 bytes
```

The metadata CRC uses the app's CRC-32 implementation with polynomial
`0x04c11db7` and initial value `0xffffffff`.

## What Is Not Included

- No Novation firmware binary
- No official `.syx`
- No decoded `.bin`
- No redistributed firmware payload

Only offsets, checks, hash values, and patching logic are stored in this
repository.
