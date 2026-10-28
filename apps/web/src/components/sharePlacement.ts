export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 4;
const MARGIN = 8;

// Fixed-position spot of the share panel: below the trigger, above when there is no room below, and right-aligned near the right edge.
export function placePanel(input: {
  trigger: Box;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
}): { top: number; left: number; placement: 'below' | 'above' } {
  const { trigger, panel, viewport } = input;
  const roomBelow = viewport.height - trigger.bottom - GAP - MARGIN;
  const roomAbove = trigger.top - GAP - MARGIN;
  const above = roomBelow < panel.height && roomAbove > roomBelow;
  const top = above ? trigger.top - GAP - panel.height : trigger.bottom + GAP;
  const overflowsRight = trigger.left + panel.width > viewport.width - MARGIN;
  const left = overflowsRight ? trigger.right - panel.width : trigger.left;
  return { top, left: Math.max(MARGIN, left), placement: above ? 'above' : 'below' };
}
