# Roadmap

1. **Safety calculations**: supply impedance input, Zs and disconnection-time checks (IEC 60364-4-41),
   prospective fault current, grouping/ambient derating with user-sourced tables.
2. **Routing**: cable tray / conduit pathways as graph edges, shortest-path routing along them,
   fill-ratio checks.
3. **Digital & mixed-signal simulation** (event-driven logic), adaptive transient timestep,
   ngspice as an optional in-app engine for full SPICE models.
4. **PLC**: IEC 61131-3 ladder/ST editor and scan-cycle simulation coupled to the control circuit.
5. **Desktop release** with Tauri (native dialogs, Python sidecar), auto-update.
6. **IFC** import/export of electrical elements (IfcElectricAppliance, IfcCableSegment, ...).
7. **Hand-tracking**: gesture for undo/redo and radial tool menu; per-user calibration profiles.
8. **Localisation**: Arabic and Kurdish (Sorani) with RTL layout, provided by qualified translators.
9. **Pluggable AI assistant provider** (LLM) behind the existing `AssistantProvider` interface,
   still restricted to proposals that pass preview + validation.
