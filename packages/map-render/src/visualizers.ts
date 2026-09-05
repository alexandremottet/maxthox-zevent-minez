export interface VisualizerDefinition {
  id: string;
  label: string;
}

// add a new entry here, then give it a real implementation in each app
export const VISUALIZERS: VisualizerDefinition[] = [
  { id: "leaflet", label: "Leaflet" },
  { id: "bluemap", label: "BlueMap" },
];

export const DEFAULT_VISUALIZER_ID = "leaflet";
