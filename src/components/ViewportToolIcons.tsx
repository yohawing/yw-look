import {
  ArrowUpIcon,
  BorderSplitIcon,
  BoxModelIcon,
  CameraIcon,
  ColorWheelIcon,
  Component1Icon,
  CubeIcon,
  DiscIcon,
  EyeOpenIcon,
  GlobeIcon,
  GridIcon,
  ImageIcon,
  LayersIcon,
  LightningBoltIcon,
  MagnifyingGlassIcon,
  MixIcon,
  MoveIcon,
  PersonIcon,
  ShadowInnerIcon,
  ShadowIcon,
  SunIcon,
  TransparencyGridIcon,
  ViewGridIcon,
} from "@radix-ui/react-icons";
import type { ViewportToolIcon } from "../types/ui";

export type { ViewportToolIcon } from "../types/ui";

type RadixIcon = typeof MoveIcon;

const viewportToolIcons: Record<ViewportToolIcon, RadixIcon> = {
  axis: MoveIcon,
  backface: BoxModelIcon,
  bbox: CubeIcon,
  camera: CameraIcon,
  environment: ImageIcon,
  grid: GridIcon,
  light: LightningBoltIcon,
  normals: ArrowUpIcon,
  palette: MixIcon,
  skeleton: PersonIcon,
  texture: ImageIcon,
  vertex: Component1Icon,
  wireframe: GlobeIcon,
  channel: ViewGridIcon,
  checker: TransparencyGridIcon,
  colorspace: ColorWheelIcon,
  inspect: MagnifyingGlassIcon,
  look: EyeOpenIcon,
  matcap: DiscIcon,
  overlay: LayersIcon,
  sceneLight: SunIcon,
  shading: ShadowInnerIcon,
  shadow: ShadowIcon,
  tiling: BorderSplitIcon,
  uv: TransparencyGridIcon,
};

export function ViewportToolSvg({ icon }: { icon: ViewportToolIcon }) {
  const Icon = viewportToolIcons[icon];
  return <Icon aria-hidden="true" />;
}
