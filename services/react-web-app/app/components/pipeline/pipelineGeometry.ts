/** Pipeline layout for the immersive command center view. viewBox 0 0 1100 350. */

export const PIPE_Y = 170;

/** Triangular formation: column 1 = one turbine (centered to pipeline), column 2 = two turbines (above/below). y is base of tower; hub is at y - 32. */
export const TURBINE_POSITIONS: { x: number; y: number }[] = [
  { x: 80, y: 202 },   /* T1: column 1, hub at PIPE_Y (170) — straight to pipeline */
  { x: 200, y: 142 }, /* T2: column 2 top */
  { x: 200, y: 262 }, /* T3: column 2 bottom */
];

export const TURBINE_X = TURBINE_POSITIONS.map((p) => p.x);
export const TURBINE_TOP_Y = 58;
export const PIPE_START_X = 260;
export const BRAIN_X = 390;
export const BUFFER_X = 560;
export const VALVE_X = 740;
export const CENTRAL_X = 920;
export const PIPE_END_X = 1040;

const TO_BUFFER_LENGTH = BUFFER_X - PIPE_START_X;
const TO_CENTRAL_LENGTH = PIPE_END_X - BUFFER_X;

export type Segment = "to-buffer" | "to-central";

export function packetPosition(
  segment: Segment,
  progress: number
): { x: number; y: number } {
  const y = PIPE_Y;
  if (segment === "to-buffer") {
    return { x: PIPE_START_X + TO_BUFFER_LENGTH * progress, y };
  }
  return { x: BUFFER_X + TO_CENTRAL_LENGTH * progress, y };
}

export const PIPE_PATH_LEFT = `M ${PIPE_START_X} ${PIPE_Y} L ${BRAIN_X} ${PIPE_Y} L ${BUFFER_X} ${PIPE_Y}`;
export const PIPE_PATH_RIGHT = `M ${BUFFER_X} ${PIPE_Y} L ${VALVE_X} ${PIPE_Y} L ${CENTRAL_X} ${PIPE_Y} L ${PIPE_END_X} ${PIPE_Y}`;
export const PIPE_PATH_FULL = `M ${PIPE_START_X} ${PIPE_Y} L ${BRAIN_X} ${PIPE_Y} L ${BUFFER_X} ${PIPE_Y} L ${VALVE_X} ${PIPE_Y} L ${CENTRAL_X} ${PIPE_Y} L ${PIPE_END_X} ${PIPE_Y}`;
