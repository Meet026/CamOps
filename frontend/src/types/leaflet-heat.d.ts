import 'leaflet'

declare module 'leaflet' {
  function heatLayer(
    points: Array<[number, number, number?]>,
    options?: { radius?: number; blur?: number; maxZoom?: number; max?: number },
  ): L.Layer
}
