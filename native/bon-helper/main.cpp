/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 * Experimental BonDriver host. Idle means CloseTuner(), never an open frontend.
 */
#include "BonDriver.h"
#include <atomic>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <cstdint>

static bool writeAll(const void* data, DWORD size) {
    auto ptr = static_cast<const BYTE*>(data);
    while (size) {
        DWORD written = 0;
        if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), ptr, size, &written, nullptr) || !written) return false;
        ptr += written;
        size -= written;
    }
    return true;
}

static void reply(uint32_t id, const char* result) {
    std::fprintf(stderr, "NYANZ_BON %u %s\n", id, result);
    std::fflush(stderr);
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 3) return 2;
    wchar_t* end = nullptr;
    const unsigned long parentPid = wcstoul(argv[2], &end, 10);
    if (!parentPid || *end) return 2;
    const HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
    if (!parent) return 2;
    // Also release hardware after a parent crash/forced termination, even if a driver call hangs.
    std::thread([parent]() {
        WaitForSingleObject(parent, INFINITE);
        ExitProcess(5);
    }).detach();
    // Resolve adjacent DLL dependencies as BonRecTest does, without searching the current directory.
    SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    HMODULE module = LoadLibraryExW(argv[1], nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if (!module) { reply(0, "ERR LoadLibrary failed"); return 3; }
    const auto create = reinterpret_cast<IBonDriver* (*)()>(GetProcAddress(module, "CreateBonDriver"));
    if (!create) { FreeLibrary(module); reply(0, "ERR CreateBonDriver missing"); return 3; }
    IBonDriver* base = create();
    // Drivers without BonDriver2 cannot select an explicit tuning space/channel safely.
    IBonDriver2* driver = dynamic_cast<IBonDriver2*>(base);
    if (!driver) {
        if (base) base->Release();
        FreeLibrary(module);
        reply(0, "ERR BonDriver2 required");
        return 3;
    }
    std::atomic<bool> running{false};
    std::atomic<bool> broken{false};
    bool opened = false;
    std::thread reader;
    const auto stop = [&]() {
        running = false;
        if (reader.joinable()) reader.join();
        if (opened) {
            driver->CloseTuner();
            opened = false;
        }
    };
    reply(0, "OK");
    std::string line;
    while (std::getline(std::cin, line)) {
        std::istringstream input(line);
        std::string command, extra;
        uint64_t id = 0, space = 0, channel = 0;
        if (!(input >> command >> id) || id == 0 || id > UINT32_MAX) break;
        if (command == "TUNE") {
            if (!(input >> space >> channel) || space > UINT32_MAX || channel > UINT32_MAX || (input >> extra)) break;
            stop();
            opened = driver->OpenTuner() != FALSE;
            if (!opened) { reply(static_cast<uint32_t>(id), "ERR OpenTuner failed"); continue; }
            if (!driver->SetChannel(static_cast<DWORD>(space), static_cast<DWORD>(channel))) {
                stop();
                reply(static_cast<uint32_t>(id), "ERR SetChannel failed");
                continue;
            }
            driver->PurgeTsStream();
            running = true;
            reader = std::thread([&, id]() {
                while (running) {
                    BYTE* data = nullptr;
                    DWORD size = 0, remain = 0;
                    if (driver->GetTsStream(&data, &size, &remain) && size) {
                        if (!data || size > 4 * 1024 * 1024) { broken = true; break; }
                        // A session id on every frame rejects old-channel data even across the two pipes.
                        const uint32_t header[] = { 0x314e424e, static_cast<uint32_t>(id), size };
                        if (!writeAll(header, sizeof(header)) || !writeAll(data, size)) { broken = true; break; }
                    }
                    // Bounded idle polling also makes STOP responsive if WaitTsStream is broken in a driver.
                    if (!size || !remain) Sleep(10);
                }
                if (broken) {
                    // Parent receives an exit and releases the stream; never leave an open tuner behind.
                    ExitProcess(4);
                }
            });
            reply(static_cast<uint32_t>(id), "OK");
        } else if (command == "STOP" || command == "QUIT") {
            if (input >> extra) break;
            stop();
            reply(static_cast<uint32_t>(id), "OK");
            if (command == "QUIT") break;
        } else {
            break;
        }
    }
    stop();
    driver->Release();
    FreeLibrary(module);
    return 0;
}
