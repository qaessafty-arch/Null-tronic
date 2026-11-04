# Known limitations

Safety & compliance
- No result means "safe" or "compliant". Fault-loop impedance, disconnection times, prospective
  short-circuit current, selectivity, earthing-system checks and cable grouping/derating are not
  implemented. Current-carrying capacity is checked only against user-entered table rows.
- Iraqi / Kurdistan Region requirements are not encoded (the reference data is replaceable).

Simulation
- No digital (logic) simulation; generic ICs/MCUs are documentation-only.
- Op-amps: ideal macro-model; no bandwidth, slew rate, offsets. Device capacitances are not modelled.
- Ideal transformer passes DC. Fixed-step transient (no adaptive timestep / breakpoints).

Design
- Cable routes are explicit polylines (auto L-route, editable vertices); they do not snap to trays
  or conduits yet. Multi-floor buildings: the model has a `floor` field but the UI shows one floor.
- No PCB layout / breadboard placement; the 3D electronic view places parts at schematic positions.
- Dimensions are associative to points, not to entities.

Exchange
- IFC not implemented. DXF import ignores blocks (INSERT), hatches, splines, dimensions (reported).
  SPICE import supports R C L V I D Q M + `.model`; subcircuits and controlled sources are reported.
- OBJ/STL carry geometry only; glTF carries component identity in node extras.

Hand tracking
- Live webcam + MediaPipe path not covered by automated tests (no camera in CI).
- No gesture for undo/redo or tool switching yet (use keyboard/toolbar).

Platform
- Runs as a local web app; desktop packaging (Tauri) is planned. File save uses the File System
  Access API where available, otherwise downloads.
- Localisation infrastructure only (English); RTL locales need translators.
