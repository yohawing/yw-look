cmake_minimum_required(VERSION 3.22)

project(yw_rhino3dm_helper VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(BUILD_TESTING OFF CACHE BOOL "Disable openNURBS tests" FORCE)
set(JSON_BuildTests OFF CACHE BOOL "Disable nlohmann/json tests" FORCE)
set(JSON_Install OFF CACHE BOOL "Do not install nlohmann/json" FORCE)

if(MSVC)
  # Apply the static MSVC runtime before FetchContent creates openNURBS and
  # its zlib target. This keeps every object in the helper on /MT and avoids
  # requiring MSVC runtime DLLs beside the release executable.
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>"
      CACHE STRING "MSVC runtime for the standalone helper" FORCE)
endif()

include(FetchContent)

# The revision is the exact openNURBS revision used by the MGY prototype.
# Keep this as a commit rather than a moving branch or a vendored copy.
set(YW_OPENNURBS_REVISION "23fc677ba06e49212296ca75fab7fb6c2851b4ce" CACHE STRING
    "Pinned openNURBS revision")
FetchContent_Declare(
  opennurbs
  GIT_REPOSITORY https://github.com/mcneel/opennurbs.git
  GIT_TAG        ${YW_OPENNURBS_REVISION}
  GIT_SHALLOW    FALSE
  GIT_PROGRESS   TRUE
)

# nlohmann/json is used only for the bounded result document and glTF JSON
# chunk. It is pinned to an immutable commit so the helper is reproducible.
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        65ee68451d8eb2b5f3a30b410476ab83deb3289b
  GIT_SHALLOW    FALSE
  GIT_PROGRESS   TRUE
)

FetchContent_MakeAvailable(opennurbs nlohmann_json)

add_executable(rhino3dm-helper rhino3dm_helper.cpp)
set_target_properties(rhino3dm-helper PROPERTIES OUTPUT_NAME "rhino3dm_preview")
target_include_directories(rhino3dm-helper PRIVATE ${opennurbs_SOURCE_DIR})
target_compile_definitions(rhino3dm-helper PRIVATE ON_CMAKE_BUILD)
target_link_libraries(rhino3dm-helper PRIVATE opennurbsStatic nlohmann_json::nlohmann_json)

if(MSVC)
  target_compile_options(rhino3dm-helper PRIVATE /EHsc /W4 /bigobj)
  set_property(TARGET rhino3dm-helper PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

if(APPLE)
  set_target_properties(rhino3dm-helper PROPERTIES MACOSX_DEPLOYMENT_TARGET "11.3")
endif()

install(TARGETS rhino3dm-helper RUNTIME DESTINATION . BUNDLE DESTINATION .)
