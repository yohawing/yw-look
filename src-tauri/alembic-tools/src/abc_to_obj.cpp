// Minimal Alembic preview extractor used by yw-look.
//
// It writes a compact binary payload to stdout. Sample 0 becomes the base mesh;
// later samples with identical topology are emitted as geometry-cache frames
// that the frontend maps to morph targets.

#include <Alembic/AbcCoreFactory/All.h>
#include <Alembic/AbcGeom/All.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <exception>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace Abc = Alembic::Abc;
namespace AbcF = Alembic::AbcCoreFactory;
namespace AbcG = Alembic::AbcGeom;

static constexpr std::size_t kMaxPreviewMeshes = 64;
static constexpr std::size_t kMaxPreviewVerticesPerMesh = 200000;
static constexpr std::size_t kMaxPreviewFramesPerMesh = 120;
static constexpr std::size_t kMaxPreviewPositionValuesPerMesh = 4000000;

struct MeshFrame {
    double time = 0.0;
    std::vector<double> positions;
};

struct PreviewMesh {
    std::string name;
    std::vector<double> positions;
    std::vector<std::uint32_t> indices;
    std::vector<MeshFrame> frames;
};

struct ConvertState {
    std::vector<PreviewMesh> meshes;
};

static std::string sanitizeName(const std::string& name) {
    if (name.empty()) {
        return "mesh";
    }

    std::string result = name;
    std::replace(result.begin(), result.end(), '/', '_');
    std::replace(result.begin(), result.end(), '\\', '_');
    std::replace(result.begin(), result.end(), ' ', '_');
    if (!result.empty() && result[0] == '_') {
        result.erase(result.begin());
    }
    return result.empty() ? "mesh" : result;
}

static Imath::V3d transformPoint(const Imath::M44d& matrix, const Imath::V3f& point) {
    Imath::V3d result(point.x, point.y, point.z);
    result *= matrix;
    return result;
}

static double linearDeterminant(const Imath::M44d& matrix) {
    const double a00 = matrix[0][0];
    const double a01 = matrix[0][1];
    const double a02 = matrix[0][2];
    const double a10 = matrix[1][0];
    const double a11 = matrix[1][1];
    const double a12 = matrix[1][2];
    const double a20 = matrix[2][0];
    const double a21 = matrix[2][1];
    const double a22 = matrix[2][2];
    return a00 * (a11 * a22 - a12 * a21)
        - a01 * (a10 * a22 - a12 * a20)
        + a02 * (a10 * a21 - a11 * a20);
}

static Imath::M44d composeWorldMatrix(
    const std::vector<AbcG::IXformSchema>& xformStack,
    Alembic::AbcCoreAbstract::index_t sampleIndex
) {
    Imath::M44d worldMatrix;
    worldMatrix.makeIdentity();
    for (auto schema : xformStack) {
        AbcG::XformSample sample;
        const auto numSamples = schema.getNumSamples();
        if (numSamples == 0) {
            continue;
        }
        const auto lastIndex =
            static_cast<Alembic::AbcCoreAbstract::index_t>(numSamples - 1);
        const Alembic::AbcCoreAbstract::index_t index =
            sampleIndex < lastIndex ? sampleIndex : lastIndex;
        schema.get(sample, Abc::ISampleSelector(index));
        worldMatrix = sample.getMatrix() * worldMatrix;
    }
    return worldMatrix;
}

template <typename Sample>
static std::vector<double> samplePositions(const Sample& sample, const Imath::M44d& worldMatrix) {
    std::vector<double> result;
    const auto positions = sample.getPositions();
    if (!positions) {
        return result;
    }

    result.reserve(positions->size() * 3);
    for (std::size_t i = 0; i < positions->size(); ++i) {
        const Imath::V3d p = transformPoint(worldMatrix, (*positions)[i]);
        result.push_back(p.x);
        result.push_back(p.y);
        result.push_back(p.z);
    }
    return result;
}

template <typename Sample>
static bool sampleTopology(const Sample& sample, std::vector<std::int32_t>& counts, std::vector<std::int32_t>& indices) {
    const auto faceIndices = sample.getFaceIndices();
    const auto faceCounts = sample.getFaceCounts();

    if (!faceIndices || !faceCounts) {
        return false;
    }

    counts.assign(faceCounts->get(), faceCounts->get() + faceCounts->size());
    indices.assign(faceIndices->get(), faceIndices->get() + faceIndices->size());
    return true;
}

template <typename Sample>
static std::vector<std::uint32_t> triangulatedIndices(const Sample& sample, bool reverseWinding) {
    std::vector<std::uint32_t> result;
    const auto faceIndices = sample.getFaceIndices();
    const auto faceCounts = sample.getFaceCounts();
    const auto positions = sample.getPositions();

    if (!positions || !faceIndices || !faceCounts) {
        return result;
    }

    std::size_t indexOffset = 0;
    for (std::size_t face = 0; face < faceCounts->size(); ++face) {
        const std::int32_t count = (*faceCounts)[face];
        if (count < 3 || indexOffset + static_cast<std::size_t>(count) > faceIndices->size()) {
            indexOffset += static_cast<std::size_t>(std::max<std::int32_t>(count, 0));
            continue;
        }

        std::vector<std::uint32_t> valid;
        for (std::int32_t i = 0; i < count; ++i) {
            const std::int32_t sourceIndex = (*faceIndices)[indexOffset + static_cast<std::size_t>(i)];
            if (sourceIndex < 0 || static_cast<std::size_t>(sourceIndex) >= positions->size()) {
                continue;
            }
            valid.push_back(static_cast<std::uint32_t>(sourceIndex));
        }
        indexOffset += static_cast<std::size_t>(count);
        if (valid.size() < 3) {
            continue;
        }

        for (std::size_t i = 1; i + 1 < valid.size(); ++i) {
            if (reverseWinding) {
                result.push_back(valid[0]);
                result.push_back(valid[i + 1]);
                result.push_back(valid[i]);
            } else {
                result.push_back(valid[0]);
                result.push_back(valid[i]);
                result.push_back(valid[i + 1]);
            }
        }
    }

    return result;
}

static bool positionsDiffer(const std::vector<double>& a, const std::vector<double>& b) {
    if (a.size() != b.size()) {
        return true;
    }
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (std::abs(a[i] - b[i]) > 1e-9) {
            return true;
        }
    }
    return false;
}

template <typename Schema>
static void collectMeshSamples(
    const std::string& name,
    Schema& schema,
    const std::vector<AbcG::IXformSchema>& xformStack,
    ConvertState& state
) {
    if (state.meshes.size() >= kMaxPreviewMeshes) {
        return;
    }

    typename Schema::Sample baseSample;
    schema.get(baseSample, Abc::ISampleSelector(Alembic::AbcCoreAbstract::index_t(0)));
    const Imath::M44d baseWorldMatrix = composeWorldMatrix(xformStack, 0);
    const bool reverseWinding = linearDeterminant(baseWorldMatrix) < 0.0;
    std::vector<std::int32_t> baseCounts;
    std::vector<std::int32_t> baseIndices;
    if (!sampleTopology(baseSample, baseCounts, baseIndices)) {
        return;
    }

    PreviewMesh mesh;
    mesh.name = sanitizeName(name);
    mesh.positions = samplePositions(baseSample, baseWorldMatrix);
    mesh.indices = triangulatedIndices(baseSample, reverseWinding);

    if (
        mesh.positions.empty() ||
        mesh.indices.empty() ||
        mesh.positions.size() / 3 > kMaxPreviewVerticesPerMesh
    ) {
        return;
    }

    const Alembic::AbcCoreAbstract::index_t sampleCount = schema.getNumSamples();
    std::set<double> seenTimes;
    std::size_t storedPositionValues = mesh.positions.size();
    for (Alembic::AbcCoreAbstract::index_t i = 0; i < sampleCount; ++i) {
        if (mesh.frames.size() >= kMaxPreviewFramesPerMesh) {
            break;
        }
        typename Schema::Sample sample;
        schema.get(sample, Abc::ISampleSelector(i));
        std::vector<std::int32_t> counts;
        std::vector<std::int32_t> indices;
        if (!sampleTopology(sample, counts, indices) || counts != baseCounts || indices != baseIndices) {
            continue;
        }

        const Imath::M44d worldMatrix = composeWorldMatrix(xformStack, i);
        std::vector<double> positions = samplePositions(sample, worldMatrix);
        if (positions.size() != mesh.positions.size()) {
            continue;
        }

        const double time = schema.getTimeSampling()->getSampleTime(i);
        if (!seenTimes.insert(time).second) {
            continue;
        }
        if (i == 0 && !positionsDiffer(positions, mesh.positions)) {
            continue;
        }
        if (storedPositionValues + positions.size() > kMaxPreviewPositionValuesPerMesh) {
            break;
        }

        storedPositionValues += positions.size();
        mesh.frames.push_back(MeshFrame{time, std::move(positions)});
    }

    state.meshes.push_back(std::move(mesh));
}

static void visitObject(
    const AbcG::IObject& object,
    std::vector<AbcG::IXformSchema>& xformStack,
    ConvertState& state
) {
    bool pushedXform = false;
    if (AbcG::IXform::matches(object.getMetaData())) {
        AbcG::IXform xform(object, Abc::kWrapExisting);
        xformStack.push_back(xform.getSchema());
        pushedXform = true;
    }

    if (AbcG::IPolyMesh::matches(object.getMetaData())) {
        AbcG::IPolyMesh mesh(object, Abc::kWrapExisting);
        auto schema = mesh.getSchema();
        collectMeshSamples(object.getFullName(), schema, xformStack, state);
    } else if (AbcG::ISubD::matches(object.getMetaData())) {
        AbcG::ISubD mesh(object, Abc::kWrapExisting);
        auto schema = mesh.getSchema();
        collectMeshSamples(object.getFullName(), schema, xformStack, state);
    }

    for (std::size_t i = 0; i < object.getNumChildren(); ++i) {
        visitObject(AbcG::IObject(object, object.getChildHeader(i).getName()), xformStack, state);
    }

    if (pushedXform) {
        xformStack.pop_back();
    }
}

static void writeU32LE(std::ostream& out, std::uint32_t value) {
    const char bytes[4] = {
        static_cast<char>(value & 0xff),
        static_cast<char>((value >> 8) & 0xff),
        static_cast<char>((value >> 16) & 0xff),
        static_cast<char>((value >> 24) & 0xff),
    };
    out.write(bytes, sizeof(bytes));
}

static void writeF32LE(std::ostream& out, double value) {
    const float floatValue = static_cast<float>(value);
    std::uint32_t bits = 0;
    std::memcpy(&bits, &floatValue, sizeof(bits));
    writeU32LE(out, bits);
}

static void writePositionsLE(std::ostream& out, const std::vector<double>& values) {
    for (const double value : values) {
        writeF32LE(out, value);
    }
}

static void writeBinaryPayload(const ConvertState& state) {
    static constexpr char kMagic[4] = {'Y', 'W', 'A', 'B'};
    std::cout.write(kMagic, sizeof(kMagic));
    writeU32LE(std::cout, 1);
    writeU32LE(std::cout, static_cast<std::uint32_t>(state.meshes.size()));
    writeU32LE(std::cout, 0);

    for (const PreviewMesh& mesh : state.meshes) {
        writeU32LE(std::cout, static_cast<std::uint32_t>(mesh.name.size()));
        std::cout.write(mesh.name.data(), static_cast<std::streamsize>(mesh.name.size()));
        writeU32LE(std::cout, static_cast<std::uint32_t>(mesh.positions.size() / 3));
        writeU32LE(std::cout, static_cast<std::uint32_t>(mesh.indices.size()));
        writeU32LE(std::cout, static_cast<std::uint32_t>(mesh.frames.size()));
        writePositionsLE(std::cout, mesh.positions);
        for (const std::uint32_t index : mesh.indices) {
            writeU32LE(std::cout, index);
        }
        for (const MeshFrame& frame : mesh.frames) {
            writeF32LE(std::cout, frame.time);
            writePositionsLE(std::cout, frame.positions);
        }
    }

    if (!std::cout) {
        throw std::runtime_error("failed to write Alembic preview payload");
    }
}

int main(int argc, char* argv[]) {
#ifdef _WIN32
    if (_setmode(_fileno(stdout), _O_BINARY) == -1) {
        std::cerr << "Unable to set stdout to binary mode.\n";
        return 1;
    }
#endif

    if (argc != 2) {
        std::cerr << "USAGE: abc_to_obj <AlembicArchive.abc>\n";
        return 2;
    }

    try {
        AbcF::IFactory factory;
        factory.setPolicy(Abc::ErrorHandler::kThrowPolicy);
        AbcF::IFactory::CoreType coreType = AbcF::IFactory::kUnknown;
        Abc::IArchive archive = factory.getArchive(argv[1], coreType);
        if (!archive) {
            std::cerr << "Unable to open Alembic archive.\n";
            return 3;
        }

        ConvertState state;
        std::vector<AbcG::IXformSchema> xformStack;
        visitObject(archive.getTop(), xformStack, state);

        if (state.meshes.empty()) {
            std::cerr << "No renderable PolyMesh/SubD sample found in Alembic archive.\n";
            return 4;
        }

        writeBinaryPayload(state);
    } catch (const std::exception& error) {
        std::cerr << "Alembic conversion failed: " << error.what() << "\n";
        return 1;
    }

    return 0;
}
