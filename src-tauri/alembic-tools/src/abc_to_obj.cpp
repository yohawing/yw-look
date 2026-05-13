// Minimal Alembic -> OBJ converter used by yw-look's first-pass Alembic
// preview path. It reads sample 0 from PolyMesh/SubD schemas and writes a
// static OBJ to stdout.

#include <Alembic/AbcCoreFactory/All.h>
#include <Alembic/AbcGeom/All.h>

#include <algorithm>
#include <exception>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace Abc = Alembic::Abc;
namespace AbcF = Alembic::AbcCoreFactory;
namespace AbcG = Alembic::AbcGeom;

struct ConvertState {
    std::ostream& out;
    std::size_t nextVertexIndex = 1;
    std::size_t meshCount = 0;
    std::size_t faceCount = 0;
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

template <typename Sample>
static void writeMeshSample(
    const std::string& name,
    const Sample& sample,
    const Imath::M44d& worldMatrix,
    ConvertState& state
) {
    const auto positions = sample.getPositions();
    const auto faceIndices = sample.getFaceIndices();
    const auto faceCounts = sample.getFaceCounts();

    if (!positions || !faceIndices || !faceCounts || positions->size() == 0 || faceCounts->size() == 0) {
        return;
    }

    const std::size_t firstVertexIndex = state.nextVertexIndex;
    state.out << "o " << sanitizeName(name) << "\n";

    for (std::size_t i = 0; i < positions->size(); ++i) {
        const Imath::V3d p = transformPoint(worldMatrix, (*positions)[i]);
        state.out << "v " << p.x << " " << p.y << " " << p.z << "\n";
    }

    std::size_t indexOffset = 0;
    for (std::size_t face = 0; face < faceCounts->size(); ++face) {
        const std::int32_t count = (*faceCounts)[face];
        if (count < 3 || indexOffset + static_cast<std::size_t>(count) > faceIndices->size()) {
            indexOffset += static_cast<std::size_t>(std::max<std::int32_t>(count, 0));
            continue;
        }

        std::vector<std::size_t> validIndices;
        for (std::int32_t i = 0; i < count; ++i) {
            const std::int32_t sourceIndex = (*faceIndices)[indexOffset + static_cast<std::size_t>(i)];
            if (sourceIndex < 0 || static_cast<std::size_t>(sourceIndex) >= positions->size()) {
                continue;
            }
            validIndices.push_back(firstVertexIndex + static_cast<std::size_t>(sourceIndex));
        }
        indexOffset += static_cast<std::size_t>(count);
        if (validIndices.size() < 3) {
            continue;
        }

        state.out << "f";
        for (const std::size_t index : validIndices) {
            state.out << " " << index;
        }
        state.out << "\n";
        state.faceCount += 1;
    }

    state.nextVertexIndex += positions->size();
    state.meshCount += 1;
}

static void visitObject(const AbcG::IObject& object, const Imath::M44d& parentMatrix, ConvertState& state) {
    Imath::M44d worldMatrix = parentMatrix;

    if (AbcG::IXform::matches(object.getMetaData())) {
        AbcG::IXform xform(object, Abc::kWrapExisting);
        AbcG::XformSample sample;
        xform.getSchema().get(sample, Abc::ISampleSelector(Alembic::AbcCoreAbstract::index_t(0)));
        worldMatrix = sample.getMatrix() * parentMatrix;
    }

    if (AbcG::IPolyMesh::matches(object.getMetaData())) {
        AbcG::IPolyMesh mesh(object, Abc::kWrapExisting);
        AbcG::IPolyMeshSchema::Sample sample;
        mesh.getSchema().get(sample, Abc::ISampleSelector(Alembic::AbcCoreAbstract::index_t(0)));
        writeMeshSample(object.getFullName(), sample, worldMatrix, state);
    } else if (AbcG::ISubD::matches(object.getMetaData())) {
        AbcG::ISubD mesh(object, Abc::kWrapExisting);
        AbcG::ISubDSchema::Sample sample;
        mesh.getSchema().get(sample, Abc::ISampleSelector(Alembic::AbcCoreAbstract::index_t(0)));
        writeMeshSample(object.getFullName(), sample, worldMatrix, state);
    }

    for (std::size_t i = 0; i < object.getNumChildren(); ++i) {
        visitObject(AbcG::IObject(object, object.getChildHeader(i).getName()), worldMatrix, state);
    }
}

int main(int argc, char* argv[]) {
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

        std::cout << "# yw-look Alembic static preview OBJ\n";
        ConvertState state{std::cout};
        Imath::M44d identity;
        identity.makeIdentity();
        visitObject(archive.getTop(), identity, state);

        if (state.meshCount == 0 || state.faceCount == 0) {
            std::cerr << "No renderable PolyMesh/SubD sample found in Alembic archive.\n";
            return 4;
        }
    } catch (const std::exception& error) {
        std::cerr << "Alembic conversion failed: " << error.what() << "\n";
        return 1;
    }

    return 0;
}
