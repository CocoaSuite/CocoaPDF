import { useApp } from "../app/store";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function setZoom(z: number) {
  useApp.setState({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 1000) / 1000)), fit: null });
}
export function zoomBy(k: number) {
  setZoom(useApp.getState().zoom * k);
}
export function setFit(fit: "width" | "page") {
  useApp.setState({ fit });
}
