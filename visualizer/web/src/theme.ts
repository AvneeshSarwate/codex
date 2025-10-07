export const stateBackground = "#faf9f5";
export const actionBackground = "#ffffff";

export function colorForAction(actionType: string): string {
  let hash = 0;
  for (let index = 0; index < actionType.length; index += 1) {
    hash = Math.imul(31, hash) + actionType.charCodeAt(index);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  const saturation = 45 + (Math.abs(hash) % 15);
  const lightness = 55 + (Math.abs(hash) % 12);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
