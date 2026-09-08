#define NOMINMAX

#include "opennurbs.h"
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

using Json = nlohmann::json;
namespace fs = std::filesystem;

namespace {

constexpr std::uint32_t kProtocolVersion = 1;
constexpr std::string_view kHelperVersion = "1.0.0";
constexpr std::string_view kHelperRevision =
    "23fc677ba06e49212296ca75fab7fb6c2851b4ce";
constexpr std::size_t kMaxResultBytes = 64U * 1024U;
constexpr std::size_t kMaxIdentityBytes = 4U * 1024U;
constexpr std::size_t kMaxDiagnosticBytes = 8U * 1024U;
constexpr int kSuccess = 0;
constexpr int kInvalidArguments = 2;
constexpr int kInvalidFile = 10;
constexpr int kNoPreviewGeometry = 11;
constexpr int kOutputLimit = 12;
constexpr int kMemoryLimit = 13;
constexpr int kAllocationFailed = 14;
constexpr int kIoError = 15;
constexpr int kInternalError = 16;

struct HelperError final : std::runtime_error {
    std::string kind;
    std::string stage;

    HelperError(std::string error_kind, std::string error_stage, std::string message)
        : std::runtime_error(std::move(message)),
          kind(std::move(error_kind)),
          stage(std::move(error_stage)) {}
};

struct Limits {
    std::uint64_t output_bytes = 256ULL * 1024ULL * 1024ULL;
    std::uint64_t nodes = 100'000;
    std::uint64_t vertices = 20'000'000;
    std::uint64_t indices = 60'000'000;
    std::uint64_t image_decoded_bytes = 256ULL * 1024ULL * 1024ULL;
    std::uint64_t recursion_depth = 64;
    std::uint64_t reference_expansions = 1'000'000;
    std::uint64_t memory_bytes = 0; // zero means no helper-side estimate limit.
};

struct Options {
    fs::path input;
    fs::path output_part;
    fs::path result_path;
    std::string request_id;
    Limits limits;
};

struct Counts {
    std::uint64_t objects = 0;
    std::uint64_t visible_objects = 0;
    std::uint64_t nodes = 0;
    std::uint64_t meshes = 0;
    std::uint64_t materials = 0;
    std::uint64_t vertices = 0;
    std::uint64_t indices = 0;
    std::uint64_t triangles = 0;
    std::uint64_t images = 0;
    std::uint64_t image_decoded_bytes = 0;
    std::uint64_t reference_expansions = 0;
    std::uint64_t max_recursion_depth = 0;
};

struct Timings {
    std::uint64_t read_ms = 0;
    std::uint64_t generate_ms = 0;
    std::uint64_t write_ms = 0;
    std::uint64_t total_ms = 0;
};

static std::uint64_t now_ms() {
    return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count());
}

static std::string bounded_text(std::string value, std::size_t limit) {
    if (value.size() <= limit) {
        return value;
    }
    value.resize(limit > 3 ? limit - 3 : limit);
    if (limit > 3) {
        value += "...";
    }
    return value;
}

static constexpr std::string_view target_os() {
#ifdef _WIN32
    return "windows";
#elif defined(__APPLE__)
    return "macos";
#else
    return "unknown";
#endif
}

static constexpr std::string_view target_arch() {
#if defined(_M_X64) || defined(__x86_64__)
    return "x86_64";
#elif defined(_M_ARM64) || defined(__aarch64__)
    return "aarch64";
#elif defined(_M_IX86) || defined(__i386__)
    return "x86";
#else
    return "unknown";
#endif
}

static std::string identity_json() {
    const Json identity = {
        {"schemaVersion", 1},
        {"protocolVersion", kProtocolVersion},
        {"helperVersion", std::string(kHelperVersion)},
        {"helperRevision", std::string(kHelperRevision)},
        {"targetOs", std::string(target_os())},
        {"targetArch", std::string(target_arch())},
        {"binaryName", "rhino3dm_preview"},
    };
    auto serialized = identity.dump();
    if (serialized.size() > kMaxIdentityBytes) {
        throw std::runtime_error("helper identity exceeds output limit");
    }
    serialized.push_back('\n');
    return serialized;
}

static bool parse_u64(std::string_view text, std::uint64_t& result) {
    if (text.empty()) {
        return false;
    }
    std::uint64_t value = 0;
    for (const char c : text) {
        if (c < '0' || c > '9') {
            return false;
        }
        const auto digit = static_cast<std::uint64_t>(c - '0');
        if (value > (std::numeric_limits<std::uint64_t>::max() - digit) / 10) {
            return false;
        }
        value = value * 10 + digit;
    }
    result = value;
    return true;
}

static void checked_add(std::uint64_t left, std::uint64_t right, const char* what,
                        std::uint64_t& result) {
    if (right > std::numeric_limits<std::uint64_t>::max() - left) {
        throw HelperError("outputLimit", "budget", std::string(what) + " overflow");
    }
    result = left + right;
}

static std::uint64_t checked_add(std::uint64_t left, std::uint64_t right, const char* what) {
    std::uint64_t result = 0;
    checked_add(left, right, what, result);
    return result;
}

static std::uint64_t checked_mul(std::uint64_t left, std::uint64_t right, const char* what) {
    if (left != 0 && right > std::numeric_limits<std::uint64_t>::max() / left) {
        throw HelperError("outputLimit", "budget", std::string(what) + " overflow");
    }
    return left * right;
}

static std::uint32_t checked_u32(std::uint64_t value, const char* what) {
    if (value > std::numeric_limits<std::uint32_t>::max()) {
        throw HelperError("outputLimit", "write", std::string(what) + " exceeds GLB u32");
    }
    return static_cast<std::uint32_t>(value);
}

static std::string uuid_string(const ON_UUID& uuid) {
    char buffer[37] = {};
    ON_UuidToString(uuid, buffer);
    return std::string(buffer);
}

static std::string utf8(const ON_wString& value) {
    ON_String text(value);
    return std::string(text.Array() == nullptr ? "" : text.Array());
}

static std::string path_for_open_nurbs(const fs::path& path) {
#ifdef _WIN32
    ON_wString wide(path.wstring().c_str());
    ON_String narrow(wide);
    return narrow.Array() == nullptr ? std::string() : std::string(narrow.Array());
#else
    return path.string();
#endif
}

static void set_result_path(const fs::path& result_path, const std::string& text) {
    if (result_path.empty()) {
        std::fwrite(text.data(), 1, text.size(), stdout);
        std::fputc('\n', stdout);
        std::fflush(stdout);
        return;
    }

    const fs::path temporary = result_path.string() + ".tmp";
    std::error_code ec;
    {
        std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
        if (!stream) {
            throw HelperError("ioError", "result", "cannot open result file");
        }
        stream.write(text.data(), static_cast<std::streamsize>(text.size()));
        stream.put('\n');
        stream.flush();
        if (!stream) {
            throw HelperError("ioError", "result", "cannot write result file");
        }
    }
    fs::rename(temporary, result_path, ec);
    if (ec) {
        fs::remove(temporary, ec);
        throw HelperError("ioError", "result", "cannot atomically publish result file: " + ec.message());
    }
}

static Json warning_array(const std::map<std::string, std::uint64_t>& warnings) {
    Json result = Json::array();
    for (const auto& [kind, count] : warnings) {
        result.push_back(Json{{"kind", kind}, {"count", count}});
    }
    return result;
}

static std::string dump_result(Json result) {
    std::string encoded = result.dump();
    if (encoded.size() <= kMaxResultBytes) {
        return encoded;
    }

    // Preserve protocol, request identity, counts, and the failure contract
    // even if an unexpected number of warning kinds was encountered.
    result["warnings"] = Json::array({Json{{"kind", "warningsTruncated"},
                                             {"count", result["warnings"].size()}}});
    result["diagnostic"] = "warning list exceeded result budget";
    encoded = result.dump();
    if (encoded.size() > kMaxResultBytes) {
        Json minimal = {
            {"schemaVersion", 1},
            {"protocolVersion", kProtocolVersion},
            {"requestId", result.value("requestId", "")},
            {"helperRevision", std::string(kHelperRevision)},
            {"ok", result.value("ok", false)},
            {"stage", result.value("stage", "result")},
            {"counts", result.value("counts", Json::object())},
            {"warnings", Json::array({Json{{"kind", "resultTruncated"}, {"count", 1}}})},
            {"timingsMs", result.value("timingsMs", Json::object())},
        };
        if (result.contains("error")) {
            minimal["error"] = result["error"];
        }
        encoded = minimal.dump();
    }
    return bounded_text(encoded, kMaxResultBytes);
}

static Json make_result(const Options& options, bool ok, std::string stage,
                        const Counts& counts, const std::map<std::string, std::uint64_t>& warnings,
                        const Timings& timings, const std::string& output_path,
                        std::uint64_t output_bytes, const HelperError* error = nullptr) {
    Json result = {
        {"schemaVersion", 1},
        {"protocolVersion", kProtocolVersion},
        {"requestId", options.request_id},
        {"helperRevision", std::string(kHelperRevision)},
        {"ok", ok},
        {"stage", std::move(stage)},
        {"counts", {
            {"objects", counts.objects},
            {"visibleObjects", counts.visible_objects},
            {"nodes", counts.nodes},
            {"meshes", counts.meshes},
            {"materials", counts.materials},
            {"vertices", counts.vertices},
            {"indices", counts.indices},
            {"triangles", counts.triangles},
            {"images", counts.images},
            {"imageDecodedBytes", counts.image_decoded_bytes},
            {"referenceExpansions", counts.reference_expansions},
            {"maxRecursionDepth", counts.max_recursion_depth},
        }},
        {"warnings", warning_array(warnings)},
        {"timingsMs", {
            {"read", timings.read_ms},
            {"generate", timings.generate_ms},
            {"write", timings.write_ms},
            {"total", timings.total_ms},
        }},
        {"output", {{"path", output_path}, {"bytes", output_bytes}}},
    };
    if (error != nullptr) {
        result["error"] = {
            {"kind", error->kind},
            {"stage", error->stage},
            {"message", bounded_text(error->what(), kMaxDiagnosticBytes)},
        };
    }
    return result;
}

static void usage_error(const std::string& message) {
    throw HelperError("invalidArguments", "arguments", message);
}

static Options parse_options(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string_view key(argv[i]);
        if (key == "--input" || key == "--output" || key == "--result" || key == "--request-id" ||
            key == "--max-output-bytes" || key == "--max-nodes" || key == "--max-vertices" ||
            key == "--max-indices" || key == "--max-image-decoded-bytes" || key == "--max-recursion-depth" ||
            key == "--max-reference-expansions" || key == "--max-memory-bytes" || key == "--protocol") {
            if (i + 1 >= argc) {
                usage_error("missing value for " + std::string(key));
            }
            const std::string value(argv[++i]);
            if (key == "--input") options.input = fs::u8path(value);
            else if (key == "--output") options.output_part = fs::u8path(value);
            else if (key == "--result") options.result_path = fs::u8path(value);
            else if (key == "--request-id") options.request_id = value;
            else {
                std::uint64_t parsed = 0;
                if (key == "--protocol") {
                    if (!parse_u64(value, parsed) || parsed != kProtocolVersion) {
                        usage_error("unsupported protocol version");
                    }
                } else if (!parse_u64(value, parsed)) {
                    usage_error("invalid integer for " + std::string(key));
                } else if (key == "--max-output-bytes") options.limits.output_bytes = parsed;
                else if (key == "--max-nodes") options.limits.nodes = parsed;
                else if (key == "--max-vertices") options.limits.vertices = parsed;
                else if (key == "--max-indices") options.limits.indices = parsed;
                else if (key == "--max-image-decoded-bytes") options.limits.image_decoded_bytes = parsed;
                else if (key == "--max-recursion-depth") options.limits.recursion_depth = parsed;
                else if (key == "--max-reference-expansions") options.limits.reference_expansions = parsed;
                else if (key == "--max-memory-bytes") options.limits.memory_bytes = parsed;
            }
            continue;
        }
        if (key == "--help" || key == "-h") {
            std::printf("rhino3dm-helper --input FILE --output FILE.part [--result FILE] --request-id ID\n");
            std::exit(0);
        }
        usage_error("unknown argument: " + std::string(key));
    }
    if (options.input.empty() || options.output_part.empty() || options.request_id.empty()) {
        usage_error("--input, --output, and --request-id are required");
    }
    if (options.output_part.extension() != ".part") {
        usage_error("--output must name a .part file");
    }
    if (options.limits.output_bytes == 0 || options.limits.nodes == 0 || options.limits.vertices == 0 ||
        options.limits.indices == 0 || options.limits.recursion_depth == 0 ||
        options.limits.reference_expansions == 0) {
        usage_error("generation limits must be greater than zero");
    }
    return options;
}

class Exporter final {
public:
    Exporter(const Options& options, Counts& counts, std::map<std::string, std::uint64_t>& warnings)
        : options_(options), counts_(counts), warnings_(warnings) {}

    std::uint64_t run(const fs::path& input, const fs::path& output_part, Timings& timings) {
        stage_ = "read";
        const auto read_start = now_ms();
        const std::string input_path = path_for_open_nurbs(input);
        if (input_path.empty()) {
            throw HelperError("invalidFile", stage_, "input path is empty");
        }
        if (!model_.Read(input_path.c_str())) {
            throw HelperError("invalidFile", stage_, "openNURBS could not read the 3DM file");
        }
        collect_components();
        timings.read_ms = now_ms() - read_start;

        stage_ = "generate";
        const auto generate_start = now_ms();
        Json roots = Json::array();
        for (const auto& [key, component] : objects_) {
            const auto* attributes = component->Attributes(nullptr);
            if (attributes != nullptr && attributes->IsInstanceDefinitionObject()) {
                continue;
            }
            const int node_index = node(key, -1, {}, 0);
            if (node_index >= 0) {
                roots.push_back(node_index);
            }
        }
        if (roots.empty()) {
            throw HelperError("noPreviewGeometry", stage_, "the 3DM contains no previewable geometry");
        }

        const double scale = ON::UnitScale(
            model_.m_settings.m_ModelUnitsAndTolerances.m_unit_system,
            ON::LengthUnitSystem::Meters);
        if (!std::isfinite(scale) || scale <= 0) {
            throw HelperError("invalidFile", stage_, "invalid model unit system");
        }
        const std::uint64_t root_index = nodes_.size();
        check_nodes(1);
        nodes_.push_back(Json{
            {"name", "Rhino Z-up to glTF Y-up"},
            {"children", roots},
            {"matrix", {scale, 0.0, 0.0, 0.0,
                         0.0, 0.0, -scale, 0.0,
                         0.0, scale, 0.0, 0.0,
                         0.0, 0.0, 0.0, 1.0}},
        });
        counts_.nodes = checked_add(counts_.nodes, 1, "nodes");
        gl_["nodes"] = nodes_;
        gl_["scenes"] = Json::array({Json{{"nodes", Json::array({root_index})}}});
        gl_["scene"] = 0;
        counts_.materials = static_cast<std::uint64_t>(gl_["materials"].size());
        gl_["buffers"] = Json::array({Json{{"byteLength", checked_u32(binary_.size(), "binary chunk")}}});
        warnings_["unsupported_textures"] += 1;
        warnings_["unsupported_full_pbr"] += 1;
        gl_["extras"] = {
            {"warnings", warning_array(warnings_)},
            {"sourceObjects", counts_.objects},
            {"unsupported", {
                {"textures", warning_count("unsupported_textures")},
                {"fullPbr", warning_count("unsupported_full_pbr")},
                {"curves", warning_count("unsupported_curves")},
                {"points", warning_count("unsupported_points")},
                {"annotations", warning_count("unsupported_annotations")},
                {"lights", warning_count("unsupported_lights")},
            }},
        };
        if (counts_.image_decoded_bytes > options_.limits.image_decoded_bytes) {
            throw HelperError("outputLimit", stage_, "decoded image bytes exceed generation budget");
        }
        timings.generate_ms = now_ms() - generate_start;

        stage_ = "write";
        const auto write_start = now_ms();
        std::string json_chunk = gl_.dump();
        while (json_chunk.size() % 4U != 0U) json_chunk.push_back(' ');
        while (binary_.size() % 4U != 0U) binary_.push_back(0);
        const std::uint64_t json_size = json_chunk.size();
        const std::uint64_t binary_size = binary_.size();
        const std::uint64_t chunks = checked_add(json_size, binary_size, "GLB chunks");
        const std::uint64_t total = checked_add(28, chunks, "GLB total");
        if (total > options_.limits.output_bytes) {
            throw HelperError("outputLimit", stage_, "GLB exceeds output byte budget");
        }
        write_atomic_glb(output_part, json_chunk, total);
        timings.write_ms = now_ms() - write_start;
        return total;
    }

private:
    struct MeshKey {
        std::string source;
        int material = -1;
        bool operator<(const MeshKey& other) const {
            return source < other.source || (source == other.source && material < other.material);
        }
    };

    const Options& options_;
    Counts& counts_;
    std::map<std::string, std::uint64_t>& warnings_;
    ONX_Model model_;
    Json gl_ = {
        {"asset", {{"version", "2.0"}, {"generator", "yw-look rhino3dm helper"}}},
        {"scene", 0},
        {"scenes", Json::array()},
        {"nodes", Json::array()},
        {"meshes", Json::array()},
        {"materials", Json::array()},
        {"accessors", Json::array()},
        {"bufferViews", Json::array()},
    };
    Json nodes_ = Json::array();
    std::vector<std::uint8_t> binary_;
    std::map<std::string, const ON_ModelGeometryComponent*> objects_;
    std::map<std::string, const ON_InstanceDefinition*> definitions_;
    std::map<std::string, int> geometry_indices_;
    std::map<MeshKey, int> mesh_indices_;
    std::map<int, int> material_indices_;
    std::map<std::string, int> material_value_indices_;
    std::uint64_t estimated_memory_ = 0;
    std::string stage_ = "read";

    void fail_limit(const char* what) const {
        throw HelperError("outputLimit", stage_, std::string(what) + " exceeds generation budget");
    }

    void check_memory(std::uint64_t additional) {
        const std::uint64_t projected = checked_add(estimated_memory_, additional, "helper memory estimate");
        if (options_.limits.memory_bytes != 0 && projected > options_.limits.memory_bytes) {
            throw HelperError("memoryLimit", stage_, "helper generation estimate exceeds memory budget");
        }
        estimated_memory_ = projected;
    }

    void check_binary(std::uint64_t additional) {
        const std::uint64_t projected = checked_add(binary_.size(), additional, "GLB binary");
        if (projected > options_.limits.output_bytes) {
            throw HelperError("outputLimit", stage_, "GLB binary exceeds output byte budget");
        }
        check_memory(additional);
    }

    void check_nodes(std::uint64_t additional) const {
        const std::uint64_t projected = checked_add(nodes_.size(), additional, "GLB nodes");
        if (projected > options_.limits.nodes || projected > static_cast<std::uint64_t>(std::numeric_limits<int>::max())) {
            throw HelperError("outputLimit", stage_, "node count exceeds generation budget");
        }
    }

    void check_vertices(std::uint64_t additional) const {
        if (checked_add(counts_.vertices, additional, "GLB vertices") > options_.limits.vertices) {
            throw HelperError("outputLimit", stage_, "vertex count exceeds generation budget");
        }
    }

    void check_indices(std::uint64_t additional) const {
        if (checked_add(counts_.indices, additional, "GLB indices") > options_.limits.indices) {
            throw HelperError("outputLimit", stage_, "index count exceeds generation budget");
        }
    }

    std::uint64_t warning_count(const std::string& kind) const {
        const auto found = warnings_.find(kind);
        return found == warnings_.end() ? 0 : found->second;
    }

    void collect_components() {
        ONX_ModelComponentIterator geometry_iterator(model_, ON_ModelComponent::Type::ModelGeometry);
        for (auto component = geometry_iterator.FirstComponent(); component != nullptr;
             component = geometry_iterator.NextComponent()) {
            const auto geometry = ON_ModelGeometryComponent::Cast(component);
            if (geometry == nullptr) continue;
            const auto* attributes = geometry->Attributes(nullptr);
            if (attributes == nullptr) continue;
            objects_[uuid_string(attributes->m_uuid)] = geometry;
            counts_.objects = checked_add(counts_.objects, 1, "objects");
        }
        ONX_ModelComponentIterator definition_iterator(model_, ON_ModelComponent::Type::InstanceDefinition);
        for (auto component = definition_iterator.FirstComponent(); component != nullptr;
             component = definition_iterator.NextComponent()) {
            if (const auto definition = ON_InstanceDefinition::Cast(component)) {
                definitions_[uuid_string(definition->Id())] = definition;
            }
        }
        counts_.materials = model_.ActiveComponentCount(ON_ModelComponent::Type::RenderMaterial);
    }

    const ON_Layer* layer(int index) const {
        return ON_Layer::FromModelComponentRef(
            model_.ComponentFromIndex(ON_ModelComponent::Type::Layer, index), nullptr);
    }

    bool visible(const ON_3dmObjectAttributes& attributes) const {
        if (!attributes.IsVisible()) return false;
        const ON_Layer* current = layer(attributes.m_layer_index);
        std::set<std::string> seen;
        while (current != nullptr) {
            if (!current->IsVisible()) return false;
            const auto key = uuid_string(current->Id());
            if (!seen.insert(key).second) {
                throw HelperError("invalidFile", stage_, "layer parent cycle");
            }
            const ON_UUID parent_id = current->ParentLayerId();
            if (ON_UuidIsNil(parent_id)) break;
            current = ON_Layer::FromModelComponentRef(
                model_.ComponentFromId(ON_ModelComponent::Type::Layer, parent_id), nullptr);
        }
        return true;
    }

    int material_index(const ON_3dmObjectAttributes& attributes, int parent) const {
        if (attributes.MaterialSource() == ON::material_from_object) return attributes.m_material_index;
        if (attributes.MaterialSource() == ON::material_from_parent && parent >= 0) return parent;
        const auto* current = layer(attributes.m_layer_index);
        return current == nullptr ? -1 : current->RenderMaterialIndex();
    }

    int material(int index) {
        const auto found = material_indices_.find(index);
        if (found != material_indices_.end()) return found->second;
        const auto* source = ON_Material::FromModelComponentRef(
            model_.ComponentFromIndex(ON_ModelComponent::Type::RenderMaterial, index), nullptr);
        const ON_Color color = source == nullptr ? ON_Color(200, 200, 200) : source->Diffuse();
        const double alpha = source == nullptr ? 1.0 : 1.0 - source->Transparency();
        Json value = {
            {"name", source == nullptr ? "Default" : utf8(source->Name())},
            {"pbrMetallicRoughness", {
                {"baseColorFactor", {color.Red() / 255.0, color.Green() / 255.0,
                                      color.Blue() / 255.0, alpha}},
                {"metallicFactor", 0.0},
                {"roughnessFactor", 0.8},
            }},
            {"doubleSided", true},
        };
        if (alpha < 1.0) value["alphaMode"] = "BLEND";
        const auto material_key = value.dump();
        const auto duplicate = material_value_indices_.find(material_key);
        if (duplicate != material_value_indices_.end()) {
            material_indices_[index] = duplicate->second;
            return duplicate->second;
        }
        const int result = static_cast<int>(gl_["materials"].size());
        gl_["materials"].push_back(value);
        material_indices_[index] = result;
        material_value_indices_[material_key] = result;
        return result;
    }

    template <typename T>
    int attribute(const std::vector<T>& values, int components, int component_type,
                  const char* type, bool bounds = false) {
        if (values.empty() || values.size() % static_cast<std::size_t>(components) != 0) {
            throw HelperError("invalidFile", stage_, "invalid generated attribute");
        }
        const auto byte_count = checked_mul(values.size(), sizeof(T), "attribute bytes");
        check_binary(checked_add(byte_count, 4, "attribute padding"));
        while (binary_.size() % 4U != 0U) binary_.push_back(0);
        const std::uint64_t offset = binary_.size();
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(values.data());
        binary_.insert(binary_.end(), bytes, bytes + byte_count);
        const int view = static_cast<int>(gl_["bufferViews"].size());
        gl_["bufferViews"].push_back({
            {"buffer", 0},
            {"byteOffset", checked_u32(offset, "buffer offset")},
            {"byteLength", checked_u32(byte_count, "buffer view length")},
        });
        Json accessor = {
            {"bufferView", view},
            {"componentType", component_type},
            {"count", values.size() / static_cast<std::size_t>(components)},
            {"type", type},
        };
        if (bounds) {
            Json min = Json::array();
            Json max = Json::array();
            for (int component = 0; component < components; ++component) {
                double low = static_cast<double>(values[component]);
                double high = low;
                for (std::size_t i = static_cast<std::size_t>(component); i < values.size();
                     i += static_cast<std::size_t>(components)) {
                    const double candidate = static_cast<double>(values[i]);
                    if (!std::isfinite(candidate)) {
                        throw HelperError("invalidFile", stage_, "non-finite geometry value");
                    }
                    low = std::min(low, candidate);
                    high = std::max(high, candidate);
                }
                min.push_back(low);
                max.push_back(high);
            }
            accessor["min"] = min;
            accessor["max"] = max;
        }
        const int result = static_cast<int>(gl_["accessors"].size());
        gl_["accessors"].push_back(accessor);
        return result;
    }

    int mesh(const std::string& key, const ON_Geometry* geometry, int material_index_value) {
        const MeshKey mesh_key{key, material_index_value};
        const auto existing = mesh_indices_.find(mesh_key);
        if (existing != mesh_indices_.end()) return existing->second;

        Json primitive;
        const auto geometry_index = geometry_indices_.find(key);
        if (geometry_index != geometry_indices_.end()) {
            if (geometry_index->second < 0) return -1;
            primitive = gl_["meshes"][geometry_index->second]["primitives"][0];
        } else {
            ON_Mesh combined;
            const ON_Mesh* mesh_value = nullptr;
            bool extrusion_geometry = false;
            if (const auto direct = ON_Mesh::Cast(geometry)) {
                mesh_value = direct;
            } else if (const auto brep = ON_Brep::Cast(geometry)) {
                ON_SimpleArray<const ON_Mesh*> meshes;
                brep->GetMesh(ON::any_mesh, meshes);
                for (int i = 0; i < meshes.Count(); ++i) if (meshes[i] != nullptr) combined.Append(*meshes[i]);
                mesh_value = &combined;
            } else if (const auto extrusion = ON_Extrusion::Cast(geometry)) {
                extrusion_geometry = true;
                mesh_value = extrusion->Mesh(ON::any_mesh);
            } else if (const auto subd = ON_SubD::Cast(geometry)) {
                ON_SubD copy(*subd);
                const auto quad_count = copy.GlobalSubdivideQuadCount(3);
                if (quad_count < 0 || static_cast<std::uint64_t>(quad_count) > options_.limits.indices / 6U) {
                    throw HelperError("outputLimit", stage_, "SubD subdivision exceeds index budget");
                }
                copy.GlobalSubdivide(3);
                copy.GetControlNetMesh(&combined, ON_SubDGetControlNetMeshPriority::Geometry);
                mesh_value = &combined;
            } else {
                switch (geometry->ObjectType()) {
                    case ON::curve_object:
                        warnings_["unsupported_curves"]++;
                        break;
                    case ON::point_object:
                    case ON::pointset_object:
                        warnings_["unsupported_points"]++;
                        break;
                    case ON::annotation_object:
                        warnings_["unsupported_annotations"]++;
                        break;
                    case ON::light_object:
                        warnings_["unsupported_lights"]++;
                        break;
                    default:
                        warnings_["unsupported_geometry"]++;
                        break;
                }
                geometry_indices_[key] = -1;
                return -1;
            }
            if (mesh_value == nullptr || mesh_value->VertexCount() == 0 || mesh_value->FaceCount() == 0) {
                warnings_[extrusion_geometry ? "missing_saved_mesh_extrusion" : "missing_saved_mesh"]++;
                geometry_indices_[key] = -1;
                return -1;
            }
            const std::uint64_t vertex_count = static_cast<std::uint64_t>(mesh_value->VertexCount());
            const std::uint64_t face_count = static_cast<std::uint64_t>(mesh_value->FaceCount());
            const std::uint64_t max_indices = checked_mul(face_count, 6, "mesh indices");
            check_vertices(vertex_count);
            check_indices(max_indices);
            const std::uint64_t position_bytes = checked_mul(vertex_count, 12, "positions");
            const std::uint64_t normal_bytes = mesh_value->HasVertexNormals() ? checked_mul(vertex_count, 12, "normals") : 0;
            const std::uint64_t uv_bytes = mesh_value->HasTextureCoordinates() ? checked_mul(vertex_count, 8, "UVs") : 0;
            const std::uint64_t color_bytes = mesh_value->HasVertexColors() ? checked_mul(vertex_count, 12, "vertex colors") : 0;
            const std::uint64_t index_bytes = checked_mul(max_indices, sizeof(std::uint32_t), "indices");
            std::uint64_t estimate = checked_add(position_bytes, normal_bytes, "mesh estimate");
            estimate = checked_add(estimate, uv_bytes, "mesh estimate");
            estimate = checked_add(estimate, color_bytes, "mesh estimate");
            estimate = checked_add(estimate, index_bytes, "mesh estimate");
            if (options_.limits.memory_bytes != 0 &&
                checked_add(estimated_memory_, estimate, "mesh estimate") > options_.limits.memory_bytes) {
                throw HelperError("memoryLimit", stage_, "mesh generation estimate exceeds memory budget");
            }

            std::vector<float> positions;
            std::vector<float> normals;
            std::vector<float> uvs;
            std::vector<float> colors;
            std::vector<std::uint32_t> indices;
            positions.reserve(static_cast<std::size_t>(checked_mul(vertex_count, 3, "position values")));
            if (normal_bytes != 0) normals.reserve(static_cast<std::size_t>(checked_mul(vertex_count, 3, "normal values")));
            if (uv_bytes != 0) uvs.reserve(static_cast<std::size_t>(checked_mul(vertex_count, 2, "UV values")));
            if (color_bytes != 0) colors.reserve(static_cast<std::size_t>(checked_mul(vertex_count, 3, "color values")));
            indices.reserve(static_cast<std::size_t>(max_indices));
            for (int i = 0; i < mesh_value->VertexCount(); ++i) {
                const auto point = mesh_value->Vertex(i);
                if (!std::isfinite(point.x) || !std::isfinite(point.y) || !std::isfinite(point.z)) {
                    throw HelperError("invalidFile", stage_, "non-finite vertex");
                }
                positions.insert(positions.end(), {static_cast<float>(point.x), static_cast<float>(point.y), static_cast<float>(point.z)});
                if (mesh_value->HasVertexNormals()) {
                    const auto normal = mesh_value->m_N[i];
                    normals.insert(normals.end(), {static_cast<float>(normal.x), static_cast<float>(normal.y), static_cast<float>(normal.z)});
                }
                if (mesh_value->HasTextureCoordinates()) {
                    const auto uv = mesh_value->m_T[i];
                    uvs.insert(uvs.end(), {static_cast<float>(uv.x), static_cast<float>(uv.y)});
                }
                if (mesh_value->HasVertexColors()) {
                    const auto color = mesh_value->m_C[i];
                    colors.insert(colors.end(), {color.Red() / 255.0F, color.Green() / 255.0F, color.Blue() / 255.0F});
                }
            }
            for (int i = 0; i < mesh_value->FaceCount(); ++i) {
                const auto face = mesh_value->m_F[i];
                const int corners = face.IsTriangle() ? 3 : 4;
                for (int corner = 0; corner < corners; ++corner) {
                    if (face.vi[corner] < 0 || face.vi[corner] >= mesh_value->VertexCount()) {
                        throw HelperError("invalidFile", stage_, "mesh index is outside vertex range");
                    }
                }
                indices.insert(indices.end(), {static_cast<std::uint32_t>(face.vi[0]),
                                               static_cast<std::uint32_t>(face.vi[1]),
                                               static_cast<std::uint32_t>(face.vi[2])});
                if (!face.IsTriangle()) {
                    indices.insert(indices.end(), {static_cast<std::uint32_t>(face.vi[0]),
                                                   static_cast<std::uint32_t>(face.vi[2]),
                                                   static_cast<std::uint32_t>(face.vi[3])});
                }
            }
            Json attributes = {{"POSITION", attribute(positions, 3, 5126, "VEC3", true)}};
            if (!normals.empty()) attributes["NORMAL"] = attribute(normals, 3, 5126, "VEC3");
            if (!uvs.empty()) attributes["TEXCOORD_0"] = attribute(uvs, 2, 5126, "VEC2");
            if (!colors.empty()) attributes["COLOR_0"] = attribute(colors, 3, 5126, "VEC3");
            primitive = {{"attributes", attributes}, {"indices", attribute(indices, 1, 5125, "SCALAR")}};
            counts_.vertices = checked_add(counts_.vertices, vertex_count, "vertices");
            counts_.indices = checked_add(counts_.indices, indices.size(), "indices");
            counts_.triangles = checked_add(counts_.triangles, indices.size() / 3, "triangles");
            geometry_indices_[key] = static_cast<int>(gl_["meshes"].size());
        }
        primitive["material"] = material(material_index_value);
        const int result = static_cast<int>(gl_["meshes"].size());
        gl_["meshes"].push_back({{"primitives", Json::array({primitive})}, {"extras", {{"sourceId", key}}}});
        mesh_indices_[mesh_key] = result;
        counts_.meshes = checked_add(counts_.meshes, 1, "meshes");
        return result;
    }

    int node(const std::string& key, int parent_material, std::set<std::string> active,
             std::uint64_t depth) {
        check_nodes(1);
        if (depth > options_.limits.recursion_depth) {
            throw HelperError("outputLimit", stage_, "instance recursion depth exceeds budget");
        }
        counts_.max_recursion_depth = std::max(counts_.max_recursion_depth, depth);
        const auto found = objects_.find(key);
        if (found == objects_.end()) {
            warnings_["missing_instance_member"]++;
            return -1;
        }
        const auto* attributes = found->second->Attributes(nullptr);
        const auto* geometry = found->second->Geometry(nullptr);
        if (attributes == nullptr || geometry == nullptr || !visible(*attributes)) return -1;
        counts_.visible_objects = checked_add(counts_.visible_objects, 1, "visible objects");
        const int resolved_material = material_index(*attributes, parent_material);
        Json current = {{"name", utf8(attributes->m_name)},
                        {"extras", {{"sourceId", key}, {"layerIndex", attributes->m_layer_index}}}};
        if (const auto reference = ON_InstanceRef::Cast(geometry)) {
            const std::string definition_id = uuid_string(reference->m_instance_definition_uuid);
            if (!active.insert(definition_id).second) {
                throw HelperError("invalidFile", stage_, "instance definition cycle");
            }
            if (active.size() > options_.limits.recursion_depth) {
                throw HelperError("outputLimit", stage_, "instance recursion depth exceeds budget");
            }
            const auto definition = definitions_.find(definition_id);
            if (definition == definitions_.end()) {
                warnings_["missing_instance_definition"]++;
                return -1;
            }
            Json children = Json::array();
            const auto ids = definition->second->InstanceGeometryIdList();
            for (int i = 0; i < ids.Count(); ++i) {
                counts_.reference_expansions = checked_add(counts_.reference_expansions, 1, "instance expansions");
                if (counts_.reference_expansions > options_.limits.reference_expansions) {
                    throw HelperError("outputLimit", stage_, "instance reference expansion exceeds budget");
                }
                const int child = node(uuid_string(ids[i]), resolved_material, active, depth + 1);
                if (child >= 0) children.push_back(child);
            }
            if (children.empty()) return -1;
            Json matrix = Json::array();
            for (int column = 0; column < 4; ++column) {
                for (int row = 0; row < 4; ++row) {
                    const double value = reference->m_xform[row][column];
                    if (!std::isfinite(value)) throw HelperError("invalidFile", stage_, "non-finite instance transform");
                    matrix.push_back(value);
                }
            }
            current["children"] = children;
            current["matrix"] = matrix;
        } else {
            const int mesh_index = mesh(key, geometry, resolved_material);
            if (mesh_index < 0) return -1;
            current["mesh"] = mesh_index;
        }
        nodes_.push_back(current);
        counts_.nodes = checked_add(counts_.nodes, 1, "nodes");
        return static_cast<int>(nodes_.size() - 1);
    }

    void write_atomic_glb(const fs::path& output_part, const std::string& json_chunk,
                          std::uint64_t total) {
        const fs::path parent = output_part.parent_path();
        std::error_code ec;
        if (!parent.empty()) fs::create_directories(parent, ec);
        if (ec) throw HelperError("ioError", stage_, "cannot create output directory: " + ec.message());
        const fs::path temporary = output_part.string() + ".tmp";
        {
            std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
            if (!stream) throw HelperError("ioError", stage_, "cannot open temporary GLB");
            const auto write_u32 = [&stream](std::uint32_t value) {
                stream.write(reinterpret_cast<const char*>(&value), sizeof(value));
            };
            write_u32(0x46546c67U);
            write_u32(2U);
            write_u32(checked_u32(total, "GLB total"));
            write_u32(checked_u32(json_chunk.size(), "JSON chunk"));
            write_u32(0x4e4f534aU);
            stream.write(json_chunk.data(), static_cast<std::streamsize>(json_chunk.size()));
            write_u32(checked_u32(binary_.size(), "binary chunk"));
            write_u32(0x004e4942U);
            stream.write(reinterpret_cast<const char*>(binary_.data()), static_cast<std::streamsize>(binary_.size()));
            stream.flush();
            if (!stream) {
                stream.close();
                fs::remove(temporary, ec);
                throw HelperError("ioError", stage_, "cannot write temporary GLB");
            }
        }
        fs::rename(temporary, output_part, ec);
        if (ec) {
            fs::remove(temporary, ec);
            throw HelperError("ioError", stage_, "cannot atomically publish GLB: " + ec.message());
        }
    }
};

static int run_helper(const Options& options) {
    Counts counts;
    Timings timings;
    std::map<std::string, std::uint64_t> warnings;
    const auto total_start = now_ms();
    std::uint64_t output_bytes = 0;
    std::string output_path;
    try {
        ON::Begin();
        {
            Exporter exporter(options, counts, warnings);
            output_bytes = exporter.run(options.input, options.output_part, timings);
        }
        timings.total_ms = now_ms() - total_start;
        output_path = options.output_part.u8string();
        const auto result = dump_result(make_result(options, true, "complete", counts, warnings,
                                                    timings, output_path, output_bytes));
        set_result_path(options.result_path, result);
        ON::End();
        return kSuccess;
    } catch (const std::bad_alloc&) {
        timings.total_ms = now_ms() - total_start;
        HelperError error("allocationFailed", "unknown", "helper allocation failed");
        const auto result = dump_result(make_result(options, false, error.stage, counts, warnings,
                                                    timings, output_path, 0, &error));
        set_result_path(options.result_path, result);
        ON::End();
        return kAllocationFailed;
    } catch (const HelperError& error) {
        timings.total_ms = now_ms() - total_start;
        const auto result = dump_result(make_result(options, false, error.stage, counts, warnings,
                                                    timings, output_path, 0, &error));
        try { set_result_path(options.result_path, result); } catch (...) {}
        ON::End();
        if (error.kind == "invalidFile") return kInvalidFile;
        if (error.kind == "noPreviewGeometry") return kNoPreviewGeometry;
        if (error.kind == "outputLimit") return kOutputLimit;
        if (error.kind == "memoryLimit") return kMemoryLimit;
        if (error.kind == "allocationFailed") return kAllocationFailed;
        if (error.kind == "ioError") return kIoError;
        return kInternalError;
    } catch (const std::exception& error) {
        timings.total_ms = now_ms() - total_start;
        HelperError wrapped("internalError", "unknown", bounded_text(error.what(), kMaxDiagnosticBytes));
        const auto result = dump_result(make_result(options, false, wrapped.stage, counts, warnings,
                                                    timings, output_path, 0, &wrapped));
        try { set_result_path(options.result_path, result); } catch (...) {}
        ON::End();
        return kInternalError;
    }
}

} // namespace

static int helper_entrypoint(int argc, char** argv) {
    try {
        if (argc == 2 && (std::string_view(argv[1]) == "--identity" ||
                          std::string_view(argv[1]) == "--version")) {
            const auto identity = identity_json();
            std::fwrite(identity.data(), 1, identity.size(), stdout);
            return kSuccess;
        }
        return run_helper(parse_options(argc, argv));
    } catch (const HelperError& error) {
        Options fallback;
        fallback.request_id = "";
        const Counts counts;
        const Timings timings;
        const std::map<std::string, std::uint64_t> warnings;
        const auto result = dump_result(make_result(fallback, false, error.stage, counts, warnings,
                                                    timings, "", 0, &error));
        std::fwrite(result.data(), 1, result.size(), stdout);
        std::fputc('\n', stdout);
        return error.kind == "invalidArguments" ? kInvalidArguments : kInternalError;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "%s\n", bounded_text(error.what(), kMaxDiagnosticBytes).c_str());
        return kInternalError;
    }
}

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
    std::vector<std::string> utf8_arguments;
    utf8_arguments.reserve(static_cast<std::size_t>(argc));
    for (int i = 0; i < argc; ++i) {
        const int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1,
                                              nullptr, 0, nullptr, nullptr);
        if (bytes <= 0) {
            return kInvalidArguments;
        }
        std::string value(static_cast<std::size_t>(bytes), '\0');
        if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1,
                                value.data(), bytes, nullptr, nullptr) <= 0) {
            return kInvalidArguments;
        }
        value.resize(static_cast<std::size_t>(bytes - 1));
        utf8_arguments.push_back(std::move(value));
    }
    std::vector<char*> converted;
    converted.reserve(utf8_arguments.size());
    for (auto& value : utf8_arguments) converted.push_back(value.data());
    return helper_entrypoint(argc, converted.data());
}
#else
int main(int argc, char** argv) {
    return helper_entrypoint(argc, argv);
}
#endif
