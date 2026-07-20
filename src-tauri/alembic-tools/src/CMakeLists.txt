cmake_minimum_required(VERSION 3.22)
project(abc_to_obj CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(VCPKG_INSTALLED_DIR AND VCPKG_TARGET_TRIPLET)
    set(_prefix "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}")
    list(APPEND CMAKE_PREFIX_PATH "${_prefix}")
    include_directories("${_prefix}/include")
    link_directories("${_prefix}/lib")
endif()

find_package(Alembic CONFIG REQUIRED)
find_package(Imath CONFIG REQUIRED)

add_executable(abc_to_obj abc_to_obj.cpp)
target_link_libraries(abc_to_obj PRIVATE Alembic::Alembic Imath::Imath)

if(WIN32)
    target_link_libraries(abc_to_obj PRIVATE ws2_32)
endif()

install(TARGETS abc_to_obj RUNTIME DESTINATION .)
