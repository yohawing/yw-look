cmake_minimum_required(VERSION 3.22)
project(usd_c_shim CXX)

# Target Pixar OpenUSD through vcpkg's toolchain. build.rs passes
# -DCMAKE_TOOLCHAIN_FILE=.../vcpkg.cmake so find_package(pxr) resolves
# against the vcpkg-installed tree for the selected triplet.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Tauri configures Windows apps with the dynamic MSVC runtime (/MD),
# so the shim must match. vcpkg's x64-windows triplet defaults to /MD
# as well, keeping everything consistent without extra flags.

find_package(pxr CONFIG REQUIRED)

add_library(usd_c_shim SHARED
    src/usd_c_shim.cpp
)

target_include_directories(usd_c_shim PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)

# Signal to the public header that we are *building* the shim, so
# USDC_API expands to dllexport (Windows) / default visibility (POSIX).
# Consumers of this library — bindgen parsing the header, Rust callers
# linking against the import library — do NOT see this define, so they
# get dllimport / no attribute, which is what we want.
target_compile_definitions(usd_c_shim PRIVATE USD_C_SHIM_BUILDING)

# Link against the Pixar OpenUSD libraries provided by vcpkg. We only
# need the subset our shim touches: stage composition + geom metrics
# for the up-axis / metersPerUnit queries.
target_link_libraries(usd_c_shim PRIVATE
    usd
    usdGeom
    usdLux
    usdShade
    usdSkel
    sdf
    tf
    plug
)

if(APPLE)
    # Put a @loader_path-relative rpath on the dylib so a .app bundle
    # where both shim and usd_ms sit in Contents/Frameworks/ resolves
    # correctly without DYLD_LIBRARY_PATH gymnastics.
    set_target_properties(usd_c_shim PROPERTIES
        INSTALL_RPATH "@loader_path"
        BUILD_WITH_INSTALL_RPATH TRUE
        MACOSX_RPATH ON
    )
endif()

if(WIN32)
    # Ensure the import lib is emitted next to the DLL so build.rs
    # can point rustc at it via cargo:rustc-link-lib=dylib=usd_c_shim.
    set_target_properties(usd_c_shim PROPERTIES
        ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    )
endif()

include(GNUInstallDirs)
install(TARGETS usd_c_shim
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
)
install(FILES include/usd_c_shim.h
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)
