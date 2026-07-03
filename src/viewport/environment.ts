import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
} from "three";
import type { EnvironmentPreset } from "../types/viewer";
import { disposeObject } from "../viewer";

export function disposeEnvironmentScene(scene: Scene) {
  disposeObject(scene);
}

export function buildEnvironmentScene(preset: EnvironmentPreset) {
  const scene = new Scene();
  const shell = new Mesh(
    new SphereGeometry(40, 40, 20),
    new MeshBasicMaterial({ color: "#121418", side: BackSide }),
  );
  scene.add(shell);

  const addPanel = ({
    color,
    position,
    size,
    rotation = [0, 0, 0],
  }: {
    color: string;
    position: [number, number, number];
    size: [number, number, number];
    rotation?: [number, number, number];
  }) => {
    const panel = new Mesh(
      new BoxGeometry(size[0], size[1], size[2]),
      new MeshBasicMaterial({ color }),
    );
    panel.position.set(position[0], position[1], position[2]);
    panel.rotation.set(rotation[0], rotation[1], rotation[2]);
    scene.add(panel);
  };

  const addGlowSphere = ({
    color,
    position,
    radius,
  }: {
    color: string;
    position: [number, number, number];
    radius: number;
  }) => {
    const glow = new Mesh(
      new SphereGeometry(radius, 24, 16),
      new MeshBasicMaterial({ color }),
    );
    glow.position.set(position[0], position[1], position[2]);
    scene.add(glow);
  };

  switch (preset) {
    case "neutral":
      shell.material.color.set("#191c21");
      addPanel({
        color: "#f3f4f8",
        position: [0, 9, -18],
        size: [14, 14, 0.45],
      });
      addPanel({
        color: "#dde3ee",
        position: [-15, 5, -8],
        size: [9, 12, 0.4],
        rotation: [0, 0.32, 0],
      });
      addPanel({
        color: "#d7dde7",
        position: [15, 4, -7],
        size: [9, 11, 0.4],
        rotation: [0, -0.34, 0],
      });
      addPanel({
        color: "#747c88",
        position: [0, -10, 0],
        size: [32, 0.5, 32],
      });
      break;
    case "outdoor":
      shell.material.color.set("#1a2432");
      addGlowSphere({
        color: "#ffe6b3",
        position: [0, 11, -16],
        radius: 3.6,
      });
      addPanel({
        color: "#7fb3ff",
        position: [-16, 5, -8],
        size: [12, 10, 0.4],
        rotation: [0, 0.42, 0],
      });
      addPanel({
        color: "#d7ecff",
        position: [14, 7, -9],
        size: [8, 12, 0.35],
        rotation: [0, -0.26, 0],
      });
      addPanel({
        color: "#4a5665",
        position: [0, -11, 0],
        size: [36, 0.5, 36],
      });
      break;
    case "studio":
    default:
      addPanel({
        color: "#ffffff",
        position: [0, 8, -16],
        size: [12, 12, 0.45],
      });
      addPanel({
        color: "#bfd0ff",
        position: [-15, 5, -9],
        size: [8, 14, 0.4],
        rotation: [0, 0.38, 0],
      });
      addPanel({
        color: "#ffe2c2",
        position: [15, 4, -8],
        size: [8, 10, 0.4],
        rotation: [0, -0.34, 0],
      });
      addPanel({
        color: "#626977",
        position: [0, -10, 0],
        size: [34, 0.5, 34],
      });
      break;
  }

  return scene;
}

export function createEnvironmentTarget(
  pmremGenerator: PMREMGenerator,
  preset: EnvironmentPreset,
) {
  const environmentScene = buildEnvironmentScene(preset);
  const target = pmremGenerator.fromScene(environmentScene, 0.04);
  disposeEnvironmentScene(environmentScene);
  return target;
}
