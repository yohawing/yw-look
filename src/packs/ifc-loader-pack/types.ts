import type { Object3D, OrthographicCamera, PerspectiveCamera } from "three";

export type IfcFragmentsModel = {
  object: Object3D;
  useCamera: (camera: PerspectiveCamera | OrthographicCamera) => void;
};

export type IfcFragmentsModels = {
  load: (
    buffer: ArrayBuffer | Uint8Array,
    options: {
      modelId: string;
      camera?: PerspectiveCamera | OrthographicCamera;
      raw?: boolean;
    },
  ) => Promise<IfcFragmentsModel>;
  update: (force?: boolean) => Promise<void>;
  /** Abort a model load while Fragments is still creating its worker model. */
  abort: (modelId: string) => void;
  dispose: () => Promise<void>;
};

export type IfcRuntimeState = {
  manager: IfcFragmentsModels;
  model: IfcFragmentsModel;
};
