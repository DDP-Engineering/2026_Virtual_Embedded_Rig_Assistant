# SPDX-License-Identifier: Apache-2.0
# VERA zephyr plugin fixture: the hardware-target build (stm32f4_disco).
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(vera_board_demo)
target_sources(app PRIVATE src/main.c)
