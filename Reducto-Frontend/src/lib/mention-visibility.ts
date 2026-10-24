export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Use physical screen coordinates, including transforms on inverted lists. */
export function mentionIsVisible(row: ScreenBounds, viewport: ScreenBounds) {
  if (
    ![
      row.x,
      row.y,
      row.width,
      row.height,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite)
  )
    return false;
  if (row.width <= 0 || row.height <= 0 || viewport.width <= 0 || viewport.height <= 0)
    return false;
  const width = Math.max(
    0,
    Math.min(row.x + row.width, viewport.x + viewport.width) - Math.max(row.x, viewport.x),
  );
  const height = Math.max(
    0,
    Math.min(row.y + row.height, viewport.y + viewport.height) - Math.max(row.y, viewport.y),
  );
  return width > 0 && height >= Math.min(row.height, viewport.height) * 0.6;
}
