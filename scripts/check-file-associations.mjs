#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const STANDARD_CONTENT_TYPES = new Map([
  ["glb", "org.khronos.glb"],
  ["gltf", "org.khronos.gltf"],
  ["fbx", "com.autodesk.mac.fbx"],
  ["obj", "public.geometry-definition-format"],
  ["ply", "public.polygon-file-format"],
  ["stl", "public.standard-tesselated-geometry-format"],
  ["dae", "org.khronos.collada.digital-asset-exchange"],
  ["usd", "com.pixar.universal-scene-description"],
  ["usda", "com.pixar.universal-scene-description-utf8"],
  ["usdc", "com.pixar.universal-scene-description-binary"],
  ["usdz", "com.pixar.universal-scene-description-mobile"],
  ["abc", "public.alembic"],
  ["png", "public.png"],
  ["jpg", "public.jpeg"],
  ["jpeg", "public.jpeg"],
  ["tga", "com.truevision.tga-image"],
  ["dds", "com.microsoft.dds"],
  ["psd", "com.adobe.photoshop-image"],
  ["hdr", "public.radiance"],
  ["exr", "com.ilm.openexr-image"],
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

function collectBundleExtensions(fileAssociations) {
  const extensions = new Set();

  for (const association of fileAssociations) {
    for (const extension of association.ext ?? []) {
      extensions.add(extension.toLowerCase());
    }
  }

  return extensions;
}

function collectSupportedExtensions(formatSupport) {
  const extensions = new Set();

  for (const category of ["model", "texture", "motion"]) {
    for (const extension of formatSupport[category] ?? []) {
      extensions.add(extension.toLowerCase());
    }
  }

  return extensions;
}

function validateAppleAssociations(fileAssociations) {
  const exportedIdentifiers = new Set();

  for (const association of fileAssociations) {
    const extensions = (association.ext ?? []).map((extension) =>
      extension.toLowerCase(),
    );
    if (association.role !== "Viewer" || association.rank !== "Alternate") {
      throw new Error(
        `Bundle association ${extensions.join(", ")} must use role=Viewer and rank=Alternate`,
      );
    }

    const expectedStandardTypes = new Set(
      extensions
        .map((extension) => STANDARD_CONTENT_TYPES.get(extension))
        .filter(Boolean),
    );
    if (expectedStandardTypes.size > 0) {
      if (
        extensions.some((extension) => !STANDARD_CONTENT_TYPES.has(extension))
      ) {
        throw new Error(
          `Standard and custom extensions must not share one association: ${extensions.join(", ")}`,
        );
      }
      const actualTypes = new Set(association.contentTypes ?? []);
      for (const contentType of expectedStandardTypes) {
        if (!actualTypes.has(contentType)) {
          throw new Error(
            `Bundle association ${extensions.join(", ")} is missing ${contentType}`,
          );
        }
      }
      if (association.exportedType) {
        throw new Error(
          `Standard association ${extensions.join(", ")} must not export a custom UTI`,
        );
      }
      continue;
    }

    if (extensions.length !== 1) {
      throw new Error(
        `Custom UTI associations must contain exactly one extension: ${extensions.join(", ")}`,
      );
    }
    const expectedIdentifier = `com.yohawing.ywlook.${extensions[0]}`;
    const exportedType = association.exportedType;
    if (exportedType?.identifier !== expectedIdentifier) {
      throw new Error(
        `Bundle association ${extensions[0]} must export ${expectedIdentifier}`,
      );
    }
    if (exportedIdentifiers.has(expectedIdentifier)) {
      throw new Error(`Duplicate exported UTI: ${expectedIdentifier}`);
    }
    exportedIdentifiers.add(expectedIdentifier);
    if (!(exportedType.conformsTo ?? []).length) {
      throw new Error(
        `Exported UTI ${expectedIdentifier} must declare conformsTo`,
      );
    }
  }
}

function sameExtensions(left, right) {
  return (
    left.length === right.length &&
    [...left]
      .sort()
      .every((extension, index) => extension === [...right].sort()[index])
  );
}

function validateMacBundle(appPath, fileAssociations) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(plistPath)) {
    throw new Error(`macOS bundle Info.plist not found: ${plistPath}`);
  }
  const result = spawnSync(
    "plutil",
    ["-convert", "json", "-o", "-", plistPath],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `plutil failed with ${result.status}`);
  }
  const plist = JSON.parse(result.stdout);
  const documentTypes = plist.CFBundleDocumentTypes ?? [];
  const exportedTypes = plist.UTExportedTypeDeclarations ?? [];

  for (const association of fileAssociations) {
    const extensions = association.ext ?? [];
    const documentType = documentTypes.find((entry) =>
      sameExtensions(entry.CFBundleTypeExtensions ?? [], extensions),
    );
    if (!documentType) {
      throw new Error(
        `Generated Info.plist is missing ${extensions.join(", ")}`,
      );
    }
    if (
      documentType.CFBundleTypeRole !== association.role ||
      documentType.LSHandlerRank !== association.rank
    ) {
      throw new Error(
        `Generated Info.plist has an invalid role/rank for ${extensions.join(", ")}`,
      );
    }

    const expectedContentTypes = association.exportedType
      ? [association.exportedType.identifier]
      : (association.contentTypes ?? []);
    const actualContentTypes = new Set(documentType.LSItemContentTypes ?? []);
    for (const contentType of expectedContentTypes) {
      if (!actualContentTypes.has(contentType)) {
        throw new Error(
          `Generated Info.plist ${extensions.join(", ")} is missing LSItemContentTypes=${contentType}`,
        );
      }
    }

    if (association.exportedType) {
      const declaration = exportedTypes.find(
        (entry) =>
          entry.UTTypeIdentifier === association.exportedType.identifier,
      );
      if (!declaration) {
        throw new Error(
          `Generated Info.plist is missing exported UTI ${association.exportedType.identifier}`,
        );
      }
      const declaredExtensions =
        declaration.UTTypeTagSpecification?.["public.filename-extension"] ?? [];
      if (!sameExtensions(declaredExtensions, extensions)) {
        throw new Error(
          `Exported UTI ${association.exportedType.identifier} has incorrect extensions`,
        );
      }
    }
  }
}

async function main() {
  const tauriConfig = await readJson("src-tauri/tauri.conf.json");
  const formatSupport = await readJson("src/formatSupport.json");
  const fileAssociations = tauriConfig.bundle?.fileAssociations ?? [];

  const bundleExtensions = collectBundleExtensions(fileAssociations);
  validateAppleAssociations(fileAssociations);
  const supportedExtensions = collectSupportedExtensions(formatSupport);

  const missingSupported = [...supportedExtensions]
    .filter((extension) => !bundleExtensions.has(extension))
    .sort();
  if (missingSupported.length > 0) {
    throw new Error(
      `Static bundle fileAssociations is missing supported extensions from formatSupport.json: ${missingSupported.join(", ")}`,
    );
  }

  console.log(
    `check:file-associations ok (${bundleExtensions.size} static extensions, ${supportedExtensions.size} supported extensions)`,
  );

  const appPath = process.argv[2];
  if (appPath) {
    validateMacBundle(path.resolve(appPath), fileAssociations);
    console.log(`check:file-associations macOS bundle ok (${appPath})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
