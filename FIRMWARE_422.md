# Launchpad X Firmware 4.2.2 Notes

This document records what this app changes in the Launchpad X 4.2.2 firmware
image. It is intentionally offset-based and does not include any firmware bytes
or bundled firmware files.

## Scope

- Target device: Novation Launchpad X
- Target firmware: 4.2.2
- Firmware input: official `.syx` from Novation Components, or a decoded raw
  firmware image
- Firmware output: patched `.syx`
- Official 4.2.2 raw firmware SHA-256:

```text
9cbb359292aeb93affc50d9b6a7b80449e034686927fc5e2e5f6572cf3ddee8e
```

The hash is calculated after decoding the SysEx into the inner raw firmware
image. It is not the hash of the `.syx` wrapper.

## Layout Guard

Before patching, the app checks fixed bytes that identify the expected 4.2.2
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

If any byte differs, patching stops. This prevents writing 4.2.2 offsets into a
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

Verification status: mixed.

The Note table above is confirmed from disassembly. The mode/custom tab
three-state table is a strong binary candidate, but the final renderer call path
has not been fully traced yet.

At raw firmware offset `0x12974`, 4.2.2 contains this repeated triplet:

```text
01 24 34  01 24 34  01 24 34  01 24 34 ...
```

This matches the expected three UI states for mode/custom style tabs:
disabled, idle/unselected, selected. The old `0x1c` guess was removed because
its occurrences in code were ambiguous and did not prove a menu LED mapping.

| UI target | Palette slot |
| --- | ---: |
| Tab disabled | `0x01` |
| Tab idle / unselected | `0x24` |
| Tab selected | `0x34` |
| Transpose A base | `0x5e` |
| Transpose A blend | `0x5f` |
| Transpose B base | `0x24` |
| Transpose B blend | `0x2d` |

When `Sync transpose color with note color` is enabled, export/write overwrites
the transpose slots from the selected Note colors:

```js
palette[0x5e] = palette[table.root];
palette[0x5f] = palette[table.root];
palette[0x24] = palette[table.scale];
palette[0x2d] = palette[table.scale];
```

Current preview model:

| Preview state | Meaning | Binary confidence |
| --- | --- | --- |
| Disabled | Black surface, no palette target | Preview-only |
| Idle | Uses candidate tab idle color `0x24` | Strong candidate |
| Selected | Uses candidate tab selected color `0x34` | Strong candidate |

Important overlap: palette slot `0x24` is also the stock Note scale color and
the Transpose B base slot. If the app writes slot `0x24`, those surfaces may
move together unless the actual Note table is changed to point at another
palette slot.

## Patch Process

1. Read a user-provided `.syx` or `.bin`.
2. Decode SysEx if needed.
3. Verify the 4.2.2 layout guard bytes.
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
| Version digits | `4.2.2` |

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
