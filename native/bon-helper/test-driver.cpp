/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 * Test fixture only. Does not access broadcast hardware.
 */
#include "BonDriver.h"
#include <cstdio>
#include <array>

#if defined(_M_IX86)
#pragma comment(linker, "/EXPORT:CreateBonDriver=_CreateBonDriver")
#endif

static void trace(const char* event) {
    wchar_t path[32768]{};
    if (!GetEnvironmentVariableW(L"BON_TEST_TRACE", path, 32768)) return;
    FILE* file = nullptr;
    if (_wfopen_s(&file, path, L"ab") == 0) {
        std::fprintf(file, "%s\n", event);
        std::fclose(file);
    }
}

class TestDriver : public IBonDriver2 {
    bool opened = false;
    DWORD channel = 0;
    DWORD space = 0;
    HANDLE lock = INVALID_HANDLE_VALUE;
    std::array<BYTE, 188 * 7> data{};
public:
    TestDriver() { trace("create"); }
    const BOOL OpenTuner() override {
        if (opened) return FALSE;
        wchar_t path[32768]{};
        if (GetEnvironmentVariableW(L"BON_TEST_LOCK", path, 32768)) {
            lock = CreateFileW(path, GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (lock == INVALID_HANDLE_VALUE) return FALSE;
        }
        opened = true;
        trace("open");
        return TRUE;
    }
    void CloseTuner() override {
        if (!opened) return;
        opened = false;
        if (lock != INVALID_HANDLE_VALUE) CloseHandle(lock);
        lock = INVALID_HANDLE_VALUE;
        trace("close");
    }
    const BOOL SetChannel(const BYTE value) override { return SetChannel(0UL, DWORD(value)); }
    const float GetSignalLevel() override { return 30; }
    const DWORD WaitTsStream(const DWORD timeout) override { Sleep(timeout); return WAIT_OBJECT_0; }
    const DWORD GetReadyCount() override { return opened ? 1 : 0; }
    const BOOL GetTsStream(BYTE* dst, DWORD* size, DWORD* remain) override {
        BYTE* ptr = nullptr;
        const BOOL result = GetTsStream(&ptr, size, remain);
        if (result) CopyMemory(dst, ptr, *size);
        return result;
    }
    const BOOL GetTsStream(BYTE** ptr, DWORD* size, DWORD* remain) override {
        *ptr = data.data();
        *size = opened ? static_cast<DWORD>(data.size()) : 0;
        *remain = 0;
        return opened;
    }
    void PurgeTsStream() override { trace("purge"); }
    void Release() override { CloseTuner(); trace("release"); delete this; }
    LPCTSTR GetTunerName() override { return L"Mirakurun test fixture"; }
    const BOOL IsTunerOpening() override { return opened; }
    LPCTSTR EnumTuningSpace(const DWORD) override { return L"test"; }
    LPCTSTR EnumChannelName(const DWORD, const DWORD) override { return L"test"; }
    const BOOL SetChannel(const DWORD newSpace, const DWORD newChannel) override {
        if (newChannel == 997) Sleep(INFINITE); // parent-death / hung driver test
        if (newChannel == 998) ExitProcess(33);
        if (newChannel == 999) return FALSE;
        space = newSpace;
        channel = newChannel;
        data.fill(static_cast<BYTE>(channel));
        for (size_t i = 0; i < data.size(); i += 188) {
            data[i] = 0x47;
            data[i + 1] = 0x1f;
            data[i + 2] = 0xff;
            data[i + 3] = 0x10;
        }
        trace("tune");
        return TRUE;
    }
    const DWORD GetCurSpace() override { return space; }
    const DWORD GetCurChannel() override { return channel; }
};

extern "C" __declspec(dllexport) IBonDriver* CreateBonDriver() { return new TestDriver(); }
