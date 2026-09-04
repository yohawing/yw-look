const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const PROFILES = new Set([
  "material-subsets",
  "authored-normals",
  "skinning",
  "point-instancer",
]);

function error(profile, message) {
  throw new Error(`${profile}: ${message}`);
}

function near(actual, expected, epsilon = 1e-6) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function parseGlb(input, profile) {
  const bytes = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      : input instanceof ArrayBuffer
        ? Buffer.from(input)
        : error(profile, "buffer must be a GLB byte buffer");
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    error(profile, "invalid GLB header");
  }
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    error(profile, "unsupported GLB version or length");
  }

  let offset = 12;
  let json;
  let bin;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) error(profile, "truncated GLB chunk header");
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > bytes.length) error(profile, "truncated GLB chunk");
    const chunk = bytes.subarray(offset + 8, end);
    if (type === 0x4e4f534a) {
      try {
        json = JSON.parse(chunk.toString("utf8").trim());
      } catch (cause) {
        error(profile, `invalid GLB JSON: ${cause.message}`);
      }
    } else if (type === 0x004e4942) {
      bin = chunk;
    }
    offset = end;
  }
  if (!json || !bin) error(profile, "GLB must contain JSON and BIN chunks");
  return { json, bin };
}

function readAccessor(doc, bin, index, profile) {
  const accessor = doc.accessors?.[index];
  const view = accessor && doc.bufferViews?.[accessor.bufferView];
  const components = accessor && COMPONENTS[accessor.type];
  const width = accessor && COMPONENT_BYTES[accessor.componentType];
  if (!accessor || !view || !components || !width) {
    error(profile, `invalid accessor ${index}`);
  }
  const stride = view.byteStride ?? components * width;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end =
    start + Math.max(0, accessor.count - 1) * stride + components * width;
  if (start < 0 || end > bin.length || stride < components * width) {
    error(profile, `accessor ${index} exceeds BIN bounds`);
  }
  const read = (at) => {
    switch (accessor.componentType) {
      case 5121:
        return bin.readUInt8(at);
      case 5123:
        return bin.readUInt16LE(at);
      case 5125:
        return bin.readUInt32LE(at);
      case 5126:
        return bin.readFloatLE(at);
      default:
        error(profile, `unsupported component type ${accessor.componentType}`);
    }
  };
  return Array.from({ length: accessor.count }, (_, row) => {
    const values = Array.from({ length: components }, (_, column) =>
      read(start + row * stride + column * width),
    );
    return components === 1 ? values[0] : values;
  });
}

function meshByName(doc, name, profile) {
  const mesh = doc.meshes?.find((entry) => entry.name === name);
  if (!mesh) error(profile, `missing mesh ${name}`);
  if (!Array.isArray(mesh.primitives) || mesh.primitives.length !== 1) {
    error(profile, `${name} must have exactly one primitive`);
  }
  return mesh;
}

function verifyMaterialSubsets(doc, bin, profile) {
  if (doc.meshes?.length !== 2)
    error(profile, "expected exactly two subset meshes");
  const expected = [
    {
      name: "/Root/MaterialSubsetPanel/RedFace",
      color: [0.85, 0.05, 0.03, 1],
      x: (value) => value <= 1e-6,
    },
    {
      name: "/Root/MaterialSubsetPanel/BlueFace",
      color: [0.03, 0.15, 0.9, 1],
      x: (value) => value >= 0.1 - 1e-6,
    },
  ];
  const materialIndices = [];
  for (const item of expected) {
    const primitive = meshByName(doc, item.name, profile).primitives[0];
    if (primitive.mode !== undefined && primitive.mode !== 4) {
      error(profile, `${item.name} is not triangles`);
    }
    const indexAccessor = doc.accessors?.[primitive.indices];
    if (!indexAccessor || indexAccessor.count !== 6) {
      error(profile, `${item.name} must contain two triangles (6 indices)`);
    }
    const material = doc.materials?.[primitive.material];
    const actual = material?.pbrMetallicRoughness?.baseColorFactor;
    if (!Array.isArray(actual) || actual.length !== 4) {
      error(profile, `${item.name} has no baseColorFactor`);
    }
    const expectedLinear = item.color.map((value, channel) =>
      channel < 3 ? srgbToLinear(value) : value,
    );
    if (
      !actual.every((value, channel) => near(value, expectedLinear[channel]))
    ) {
      error(profile, `${item.name} material color is incorrect`);
    }
    const positions = readAccessor(
      doc,
      bin,
      primitive.attributes?.POSITION,
      profile,
    );
    if (positions.length !== 6 || !positions.every((row) => item.x(row[0]))) {
      error(profile, `${item.name} POSITION does not identify its face`);
    }
    materialIndices.push(primitive.material);
  }
  if (materialIndices[0] === materialIndices[1]) {
    error(profile, "subset faces share one material assignment");
  }
  return { profile, meshes: 2, materialIndices, indexCounts: [6, 6] };
}

function verifyAuthoredNormals(doc, bin, profile) {
  const mesh = meshByName(doc, "/Root/AuthoredTiltedQuad", profile);
  const primitive = mesh.primitives[0];
  const normals = readAccessor(doc, bin, primitive.attributes?.NORMAL, profile);
  const positions = readAccessor(
    doc,
    bin,
    primitive.attributes?.POSITION,
    profile,
  );
  if (normals.length !== 6 || positions.length !== 6) {
    error(profile, "NORMAL and POSITION must each contain six vertices");
  }
  const expected = [0, 0.6, 0.8];
  if (
    !normals.every((row) => row.every((value, i) => near(value, expected[i])))
  ) {
    error(profile, "authored tilted normals were lost or changed");
  }
  return {
    profile,
    normalCount: normals.length,
    positionCount: positions.length,
  };
}

function verifySkinning(doc, bin, profile) {
  if (doc.skins?.length !== 1) error(profile, "expected one skin");
  const skin = doc.skins[0];
  if (!Array.isArray(skin.joints) || skin.joints.length !== 2) {
    error(profile, "skin must contain two joints");
  }
  const ibmAccessor = doc.accessors?.[skin.inverseBindMatrices];
  if (ibmAccessor?.componentType !== 5126 || ibmAccessor.type !== "MAT4") {
    error(profile, "inverse bind matrices must be a FLOAT MAT4 accessor");
  }
  const inverseBind = readAccessor(doc, bin, skin.inverseBindMatrices, profile);
  if (
    inverseBind.length !== 2 ||
    !inverseBind.every((row) => row.every(Number.isFinite))
  ) {
    error(profile, "inverse bind matrices are missing or invalid");
  }
  if (
    doc.animations?.length !== 1 ||
    doc.animations[0].channels?.length !== 6
  ) {
    error(profile, "expected one animation with six channels");
  }
  const meshIndex = doc.meshes?.findIndex((mesh) =>
    mesh.primitives?.some((entry) => entry.attributes?.JOINTS_0 !== undefined),
  );
  const primitive =
    meshIndex >= 0
      ? doc.meshes[meshIndex].primitives.find(
          (entry) => entry.attributes?.JOINTS_0 !== undefined,
        )
      : undefined;
  if (!primitive || primitive.attributes.WEIGHTS_0 === undefined) {
    error(profile, "mesh is missing JOINTS_0 or WEIGHTS_0");
  }
  if (!doc.nodes?.some((node) => node.mesh === meshIndex && node.skin === 0)) {
    error(profile, "skin node binding is missing");
  }
  const positionAccessor = doc.accessors?.[primitive.attributes.POSITION];
  const jointsAccessor = doc.accessors?.[primitive.attributes.JOINTS_0];
  const weightsAccessor = doc.accessors?.[primitive.attributes.WEIGHTS_0];
  if (positionAccessor?.type !== "VEC3") {
    error(profile, "skinned mesh is missing a POSITION VEC3 accessor");
  }
  if (
    jointsAccessor?.componentType !== 5123 ||
    jointsAccessor.type !== "VEC4"
  ) {
    error(profile, "JOINTS_0 must be an UNSIGNED_SHORT VEC4 accessor");
  }
  if (
    weightsAccessor?.componentType !== 5126 ||
    weightsAccessor.type !== "VEC4"
  ) {
    error(profile, "WEIGHTS_0 must be a FLOAT VEC4 accessor");
  }
  const positions = readAccessor(
    doc,
    bin,
    primitive.attributes.POSITION,
    profile,
  );
  const joints = readAccessor(doc, bin, primitive.attributes.JOINTS_0, profile);
  const weights = readAccessor(
    doc,
    bin,
    primitive.attributes.WEIGHTS_0,
    profile,
  );
  if (
    positions.length === 0 ||
    positions.length !== joints.length ||
    joints.length !== weights.length
  ) {
    error(profile, "POSITION, JOINTS_0, and WEIGHTS_0 counts differ");
  }
  for (let row = 0; row < joints.length; row += 1) {
    if (
      !joints[row].every(
        (value) => Number.isInteger(value) && value < skin.joints.length,
      )
    ) {
      error(profile, `joint index out of range at vertex ${row}`);
    }
    if (
      !weights[row].every((value) => Number.isFinite(value) && value >= 0) ||
      !near(
        weights[row].reduce((sum, value) => sum + value, 0),
        1,
        1e-5,
      )
    ) {
      error(profile, `weights are not normalized at vertex ${row}`);
    }
  }
  return {
    profile,
    joints: skin.joints.length,
    vertices: joints.length,
    channels: 6,
  };
}

function verifyPointInstancer(doc, bin, profile) {
  const expected = new Map([
    ["/Root/Instancer/PrototypeCube", [-3, -0.6, 1.8]],
    ["/Root/Instancer/PrototypePyramid", [-1.8, 3]],
  ]);
  const nodes = (doc.nodes ?? []).filter(
    (node) => node.extensions?.EXT_mesh_gpu_instancing,
  );
  if (nodes.length !== expected.size)
    error(profile, "expected two instanced nodes");
  const counts = {};
  const seen = new Set();
  for (const node of nodes) {
    const meshName = doc.meshes?.[node.mesh]?.name;
    const wanted = [...expected.keys()].find((name) => meshName === name);
    if (!wanted) error(profile, `unknown instanced prototype ${meshName}`);
    if (seen.has(wanted))
      error(profile, `duplicate instanced prototype ${wanted}`);
    seen.add(wanted);
    const translationIndex =
      node.extensions.EXT_mesh_gpu_instancing.attributes?.TRANSLATION;
    const translations = readAccessor(doc, bin, translationIndex, profile);
    const wantedX = expected.get(wanted);
    if (
      translations.length !== wantedX.length ||
      !translations.every((row, index) => near(row[0], wantedX[index]))
    ) {
      error(profile, `${wanted} instance translations are incorrect`);
    }
    counts[wanted.endsWith("Cube") ? "cube" : "pyramid"] = translations.length;
  }
  if (seen.size !== expected.size)
    error(profile, "an expected prototype is missing");
  return { profile, instanceCounts: counts };
}

export function verifyGlbFeatures(profile, buffer) {
  if (!PROFILES.has(profile)) error(profile, "unknown GLB feature profile");
  const { json, bin } = parseGlb(buffer, profile);
  switch (profile) {
    case "material-subsets":
      return verifyMaterialSubsets(json, bin, profile);
    case "authored-normals":
      return verifyAuthoredNormals(json, bin, profile);
    case "skinning":
      return verifySkinning(json, bin, profile);
    case "point-instancer":
      return verifyPointInstancer(json, bin, profile);
    default:
      error(profile, "unknown GLB feature profile");
  }
}
