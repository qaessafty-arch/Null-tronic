# Native project format (`.ntcs.json`)

UTF-8 JSON. JSON Schema: [`shared/schemas/project.schema.json`](../../shared/schemas/project.schema.json).
TypeScript definition (authoritative): `frontend/src/project-model/types.ts`.

```jsonc
{
  "format": "nulltech-circuit-studio-project",
  "schemaVersion": 1,
  "type": "electronic | installation | control",
  "meta": { "id", "name", "author", "organisation", "revision", "revisions": [...], ... },
  "settings": { "displayUnit", "gridMm", "supplyVoltage", "voltageDropLimit*", "ampacityTable": [...], "unitPrices": {...}, ... },
  "components": { "<id>": { "id", "type", "ref", "position": {x,y}, "rotation", "mirror", "elevation", "properties": {...}, "layer" } },
  "wires":      { "<id>": { "id", "a": Endpoint, "b": Endpoint, "vertices": [{x,y}], "role", "layer" } },
  "junctions":  { "<id>": { "id", "position" } },
  "rooms":      { "<id>": { "id", "name", "polygon": [...], "height", "wallThickness", "floor" } },
  "circuits":   { "<id>": { "id", "name", "boardId", "deviceIds": [...], "phase", "category", "protection", "cable", "demandFactor" } },
  "cables":     { "<id>": { "id", "circuitId", "fromId", "toId", "path": [...], "routeElevation" } },
  "annotations":{ "<id>": { "id", "kind", "points", ... } },
  "layers": [...], "sheets": [...]
}
```

- All lengths in **millimetres**; 2D +y points down; `elevation` is height above floor/board (3D Y).
- `Endpoint` = `{ "kind": "pin", "componentId", "pinId" }` or `{ "kind": "junction", "junctionId" }`.
- Nets are **not stored**: they are derived from wires, junctions, coincident pins, net labels and
  ground symbols. Net names are stable: label name, `0` for ground, else `N_<ref>_<pin>` of the
  alphabetically first pin.
- IDs are stable random identifiers (`cmp_…`, `w_…`).

## Loading

`parseProject()` (a) parses JSON, (b) migrates older `schemaVersion`s step by step
(`MIGRATIONS[v]` upgrades v → v+1), (c) validates structure and references (unknown component
types, dangling wire endpoints, missing boards, bad polygons) and reports precise messages,
(d) forward-fills settings added later. Files from a newer schema are refused.

Autosave (every 20 s with unsaved changes, and on page close) and up to 10 snapshots are kept in
browser storage; **File ▸ Recover / snapshots** restores them.
