# SPDX-License-Identifier: Apache-2.0
# VERA zephyr plugin fixture: a ztest suite built by Twister (build-only) and run on the LAB-06 Renode profile.
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(vera_ztest_basic)
target_sources(app PRIVATE src/main.c)
