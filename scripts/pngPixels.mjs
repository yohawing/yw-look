import { inflateSync } from "node:zlib";

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

export function decodePngPixels(buffer) {
  if (buffer.length < 8 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("not a PNG file");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  }

  const channelsByColorType = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4],
  ]);
  const channels = channelsByColorType.get(colorType);
  if (!channels) {
    throw new Error(`unsupported PNG color type: ${colorType}`);
  }

  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1);
    const filter = inflated[sourceOffset];
    const rowStart = sourceOffset + 1;
    const outputOffset = y * stride;
    const prevOutputOffset = outputOffset - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[rowStart + x];
      const left = x >= channels ? pixels[outputOffset + x - channels] : 0;
      const up = y > 0 ? pixels[prevOutputOffset + x] : 0;
      const upLeft =
        y > 0 && x >= channels ? pixels[prevOutputOffset + x - channels] : 0;

      switch (filter) {
        case 0:
          pixels[outputOffset + x] = raw;
          break;
        case 1:
          pixels[outputOffset + x] = (raw + left) & 0xff;
          break;
        case 2:
          pixels[outputOffset + x] = (raw + up) & 0xff;
          break;
        case 3:
          pixels[outputOffset + x] = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          pixels[outputOffset + x] =
            (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unsupported PNG filter: ${filter}`);
      }
    }
  }

  return { width, height, colorType, channels, pixels };
}

export function comparePixels(actualBuffer, expectedBuffer) {
  const actual = decodePngPixels(actualBuffer);
  const expected = decodePngPixels(expectedBuffer);
  return (
    actual.width === expected.width &&
    actual.height === expected.height &&
    actual.colorType === expected.colorType &&
    Buffer.compare(actual.pixels, expected.pixels) === 0
  );
}
