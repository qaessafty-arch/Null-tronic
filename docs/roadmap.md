# Roadmap

1. **Safety calculations** (done: Zs / TN / TT, breaking capacity): next IT systems, line-to-line
   short-circuit, selectivity, k²S² thermal withstand, grouping/ambient derating with user-sourced tables.
2. **Routing** (done: trays): conduits, tray fill ratios, multi-level containment.
3. **Digital simulation** (done: zero-delay gates): event-driven timing, flip-flops; adaptive
   transient timestep; ngspice as an optional in-app engine.
4. **PLC** (done: Boolean ST scan, TON/TOF timers, CTU counter): ET/CV values and comparisons, CTD, R_TRIG/F_TRIG, ladder-diagram view of the program.
5. **Desktop release** (shell done): Python service as a Tauri sidecar, signed installers for Windows/macOS/Linux, auto-update.
6. **IFC** import/export of electrical elements (IfcElectricAppliance, IfcCableSegment, ...).
7. **Hand-tracking**: gesture for undo/redo and radial tool menu; per-user calibration profiles.
8. **Localisation**: Arabic and Kurdish (Sorani) with RTL layout, provided by qualified translators.
9. **Pluggable AI assistant provider** (LLM) behind the existing `AssistantProvider` interface,
   still restricted to proposals that pass preview + validation.
