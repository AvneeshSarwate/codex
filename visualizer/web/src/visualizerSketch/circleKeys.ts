import { eventSubtype, eventId } from "./eventDetails";
import { VisualizerEvent } from "../visualizerTypes";

export function buildEventMatchKey(event: VisualizerEvent): string {
  const id = eventId(event);
  if (id) {
    return id;
  }
  const subtype = eventSubtype(event);
  return `${event.actionType}::${subtype ?? ""}`;
}
