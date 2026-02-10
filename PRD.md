# Product Requirements Document: Comically Large Paintbrush Drawing Game

## Project Overview

A multiplayer drawing game using giant physical paintbrushes as alternative controllers, camera-based position tracking, and projection mapping for an immersive, physical-digital play experience.

**Tech Stack:** Kaplay.js, Computer Vision (camera triangulation), Projection Mapping, MongoDB

---

## Feature Checklist

### 1. Hardware & Physical Setup

#### Paintbrush Controllers
- [ ] Design and build oversized paintbrush props (determine size/weight for playability)
- [ ] Attach trackable markers/LEDs to paintbrush tips for camera detection
- [ ] Ensure markers are distinguishable per player (color-coded or unique patterns)
- [ ] Test durability and ergonomics for extended play sessions

#### Camera Tracking System
- [ ] Set up minimum 2 cameras for triangulation (determine optimal placement)
- [ ] Calibrate cameras for the play space dimensions
- [ ] Implement marker/LED detection algorithm
- [ ] Calculate 3D position from multiple camera feeds
- [ ] Map 3D coordinates to 2D canvas/projection space
- [ ] Handle occlusion edge cases (player blocking camera view)

#### Projection Mapping
- [ ] Select and mount projector(s) for play surface
- [ ] Calibrate projection to physical play area boundaries
- [ ] Account for surface irregularities if projecting on non-flat surfaces
- [ ] Ensure adequate brightness for venue lighting conditions

---

### 2. Core Game Engine (Kaplay.js)

#### Canvas & Rendering
- [ ] Initialize Kaplay.js game instance
- [ ] Set up canvas matching projection resolution
- [ ] Implement drawing layer (persistent brush strokes)
- [ ] Implement UI layer (scores, timers, prompts)
- [ ] Target 60fps rendering performance

#### Input Processing
- [ ] Parse incoming position data for each tracked paintbrush
- [ ] Normalize coordinates to canvas space
- [ ] Smooth input data to reduce jitter (moving average or Kalman filter)
- [ ] Detect brush "lift" vs "press" state (Z-axis or pressure threshold)

#### Drawing Mechanics
- [ ] Render brush strokes when paintbrush is in "drawing" state
- [ ] Support variable brush sizes
- [ ] Support multiple brush colors (per player or selectable)
- [ ] Implement stroke smoothing/interpolation for fluid lines

---

### 3. Game Modes

#### Split Canvas
- [ ] Randomized prompt.
- [ ] One canvas, each brush can only draw on one side of the canvas.
- [ ] Color/brush selection UI.
- [ ] 3 minute timer.
- [ ] Save image of drawing at the end to MongoDB.

---

### 4. Multiplayer System

#### Player Management
- [ ] Support 2 simultaneous players
- [ ] Player color/identifier assignment
- [ ] Player ready-up system for game start

#### Session Management
- [ ] Game lobby/waiting room state
- [ ] Round progression logic
- [ ] Return to lobby or play again options

---

### 5. User Interface

#### In-Game HUD
- [ ] Player indicators (colors, names, scores)
- [ ] Current prompt display
- [ ] Round/game timer
- [ ] Current brush color/size indicator per player
- [ ] Brush size options and undo button

#### Menu Screens
- [ ] Title/splash screen
- [ ] Mode selection menu
- [ ] Credits screen

#### Feedback & Polish
- [ ] Visual feedback when brush enters drawing zone
- [ ] Sound effects for drawing, round start/end, scoring
- [ ] Background music (toggleable)
- [ ] Particle effects or visual flair on special events

---

### 6. Technical Infrastructure

#### Communication Layer
- [ ] Define message protocol (position, player ID, brush state)
- [ ] Synchronize game state across all display outputs

#### Computer Vision Pipeline
- [ ] Camera feed capture and processing
- [ ] Marker detection and identification
- [ ] Multi-camera coordinate fusion
- [ ] Output position data stream to game server

#### Configuration & Calibration
- [ ] Calibration mode for camera alignment
- [ ] Calibration mode for projection mapping
- [ ] Save/load calibration profiles
- [ ] Runtime adjustment tools for fine-tuning

---

### 7. Testing & Quality

#### Functional Testing
- [ ] Single player drawing accuracy test
- [ ] Multi-player simultaneous tracking test
- [ ] Game mode flow testing (start to finish)
- [ ] Edge case handling (out of bounds, rapid movement)

#### Performance Testing
- [ ] Long-session stability test (no memory leaks, crashes)

#### User Testing
- [ ] Playtest with target audience
- [ ] Gather feedback on physical controller comfort
- [ ] Iterate on game rules based on play sessions

---

### 8. Documentation & Delivery

- [ ] Setup guide for hardware installation
- [ ] Calibration procedure documentation
- [ ] Software installation and run instructions
- [ ] Troubleshooting guide for common issues
- [ ] Final presentation/demo materials

---

## Success Criteria

1. **Tracking Accuracy:** Brush position maps to projected canvas within ±1cm accuracy
2. **Latency:** Input-to-display lag under 50ms
3. **Stability:** System runs for 30+ minutes without crashes
4. **Playability:** Users can intuitively draw recognizable shapes within first attempt
5. **Fun Factor:** Playtesters rate enjoyment 4+/5 on average

---

## Open Questions

- [ ] What surface will the game be projected onto? (floor, wall, table)
- [ ] Indoor or outdoor venue? (affects lighting and projection)
- [ ] What is the play area size? (affects camera placement and resolution needs)
- [ ] Budget for hardware (cameras, projectors, paintbrush materials)?
- [ ] Will there be a prompt database, or generated on the fly?
- [ ] Any accessibility considerations for players?

---

## Timeline Milestones

| Phase | Deliverables |
|-------|--------------|
| **Phase 1** | Hardware prototype, basic camera tracking working |
| **Phase 2** | Kaplay.js canvas rendering, tracking data integration |
| **Phase 3** | Core drawing mechanics, single player functional |
| **Phase 4** | Multiplayer support, game modes implemented |
| **Phase 5** | Polish, playtesting, bug fixes |
| **Phase 6** | Final demo, documentation complete |
