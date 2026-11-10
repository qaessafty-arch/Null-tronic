# Known limitations

Safety & compliance
- No result means "safe" or "compliant". Earth-fault loop impedance and disconnection conditions are
  checked for TN (Zs·Ia ≤ U0, instantaneous-trip current) and TT (RA·IΔn ≤ 50 V) only when Ze / RA are
  entered; IT systems, short-circuit between live conductors, selectivity, cable thermal withstand and
  grouping/derating are not implemented. Current-carrying capacity is checked only against
  user-entered table rows.
- Iraqi / Kurdistan Region requirements are not encoded (the reference data is replaceable).

Simulation
- Logic gates are zero-delay combinational models (no propagation delay, no flip-flops); generic ICs/MCUs are documentation-only.
- PLC programs: Boolean Structured Text subset (assignments, IF/ELSIF/ELSE) with TON / TOF timers and the CTU up-counter. Only the Boolean output `.Q` is readable (no ET / CV), and there is no arithmetic, comparison, CTD/CTUD, edge-detect (R_TRIG) or user function block; no vendor PLC or protocol emulation.
- PLC timers follow simulation time: they act only in transient analysis, with a resolution of one time step. At the operating point no time has elapsed (reported as a review finding), and counter values are not kept between separate runs.
- Op-amps: ideal macro-model; no bandwidth, slew rate, offsets. Device capacitances are not modelled.
- Ideal transformer passes DC. Fixed-step transient (no adaptive timestep / breakpoints).

Design
- Cable routing follows cable trays (axis-aligned tray components) via a shortest-path search;
  conduits, tray fill ratios and multi-level containment are not modelled. Multi-floor buildings: the model has a `floor` field but the UI shows one floor.
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
- Desktop app (Tauri) builds and launches on Linux; installer bundles, code signing and Windows/macOS
  builds have not been produced here, and the native save/open dialogs were compiled but not
  exercised interactively. The Python service is not yet bundled as a sidecar. In browsers, file save
  uses the File System Access API where available, otherwise downloads.
- Localisation infrastructure only (English); RTL locales need translators.
