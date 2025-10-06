export const stateBackground = "#f8fafc";
export const actionBackground = "#ffffff";

export function colorForAction(actionType: string): string {
  let hash = 0;
  for (let index = 0; index < actionType.length; index += 1) {
    hash = Math.imul(31, hash) + actionType.charCodeAt(index);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  const saturation = 60 + (Math.abs(hash) % 20);
  const lightness = 45 + (Math.abs(hash) % 10);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
