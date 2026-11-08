/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 * BonDriver / BonDriver2 public binary interface (MSVC, no virtual destructor).
 */
#pragma once
#include <windows.h>

class IBonDriver {
public:
    virtual const BOOL OpenTuner(void) = 0;
    virtual void CloseTuner(void) = 0;
    virtual const BOOL SetChannel(const BYTE channel) = 0;
    virtual const float GetSignalLevel(void) = 0;
    virtual const DWORD WaitTsStream(const DWORD timeout = 0) = 0;
    virtual const DWORD GetReadyCount(void) = 0;
    virtual const BOOL GetTsStream(BYTE* dst, DWORD* size, DWORD* remain) = 0;
    virtual const BOOL GetTsStream(BYTE** ptr, DWORD* size, DWORD* remain) = 0;
    virtual void PurgeTsStream(void) = 0;
    virtual void Release(void) = 0;
};

class IBonDriver2 : public IBonDriver {
public:
    virtual LPCTSTR GetTunerName(void) = 0;
    virtual const BOOL IsTunerOpening(void) = 0;
    virtual LPCTSTR EnumTuningSpace(const DWORD space) = 0;
    virtual LPCTSTR EnumChannelName(const DWORD space, const DWORD channel) = 0;
    virtual const BOOL SetChannel(const DWORD space, const DWORD channel) = 0;
    virtual const DWORD GetCurSpace(void) = 0;
    virtual const DWORD GetCurChannel(void) = 0;
};
