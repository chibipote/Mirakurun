/*
   Copyright 2026 kanreisa

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
import * as React from "react";
import { useState, useEffect } from "react";
import {
    Alignment,
    Breadcrumbs,
    Button,
    Checkbox,
    Dialog,
    DialogBody,
    DialogFooter,
    FormGroup,
    InputGroup,
    Navbar,
    NonIdealState,
    Spinner,
    Switch,
    HTMLTable,
    HTMLSelect,
    Callout
} from "@blueprintjs/core";
import equal from "fast-deep-equal";
import * as ui from "../modules/ui";
import { ConfigTuners, ConfigTunersItem, ChannelType, RemoteMirakurun } from "../../../api.d";
import { parseCommandForSpawn } from "../../Mirakurun/command";

import "./TunersConfigView.sass";

const configAPI = "/api/config/tuners";
const grAltChannelTypes = Array.from({ length: 20 }, (_, i) => `GR-ALT${i + 1}` as ChannelType);
const channelTypeOptions = ["GR" as ChannelType, ...grAltChannelTypes, "BS" as ChannelType, "CS" as ChannelType, "SKY" as ChannelType];
const typesIndex = channelTypeOptions;

function sortTypes(types: ChannelType[]): ChannelType[] {
    return types.sort((a, b) => typesIndex.indexOf(a) - typesIndex.indexOf(b));
}

function getChannelTypeDisplayName(type: ChannelType): string {
    return type.startsWith("GR-ALT") ? type.replace("GR-", "") : type;
}

// サーバーと同じく、コマンドを解釈したファイル名で dvbv5-zap かを判定する
function isDvbv5ZapCommand(command: string): boolean {
    try {
        return parseCommandForSpawn(command).command.split("/").pop() === "dvbv5-zap";
    } catch {
        // 空のコマンド
        return false;
    }
}

function isBonRecTestCommand(command: string): boolean {
    try {
        const commandName = parseCommandForSpawn(command).command.split(/[\\/]/).pop() || "";
        return /^BonRecTest(?:\.exe)?$/i.test(commandName);
    } catch {
        return false;
    }
}

export const TunersConfigView: React.FC = () => {
    console.debug("routes", "TunersConfigView");

    const [current, setCurrent] = useState<ConfigTuners | null>(null);
    const [editing, setEditing] = useState<ConfigTuners | null>(null);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [saved, setSaved] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [remoteMachines, setRemoteMachines] = useState<RemoteMirakurun[]>([]);
    const [saveError, setSaveError] = useState("");
    const [loadError, setLoadError] = useState("");
    const [reload, setReload] = useState(0);

    ui.setTitle("チューナー設定", isLoading);

    useEffect(() => {
        if (saved === true) {
            setTimeout(() => {
                // Restart notification will be emitted in production when requested
            }, 500);
            setSaved(false);
            return;
        }

        let disposed = false;
        const controller = new AbortController();
        setIsLoading(true);
        setLoadError("");
        (async () => {
            try {
                const [response, serverResponse] = await Promise.all([
                    fetch(configAPI, { signal: controller.signal }),
                    fetch("/api/config/server", { signal: controller.signal })
                ]);
                if (!response.ok || !serverResponse.ok) throw new Error("設定を取得できませんでした。");
                const [res, serverConfig] = await Promise.all([response.json(), serverResponse.json()]);
                if (disposed) return;
                setEditing(JSON.parse(JSON.stringify(res)));
                setCurrent(JSON.parse(JSON.stringify(res)));
                setRemoteMachines((serverConfig.remoteMirakuruns || []).filter(peer => peer.role === "child"));
                setIsLoading(false);
            } catch (e) {
                if (!disposed) {
                    setLoadError("チューナー設定・接続先マシンの取得に失敗しました。");
                    setIsLoading(false);
                }
            }
        })();
        return () => { disposed = true; controller.abort(); };
    }, [saved, reload]);

    const hasChanges = editing !== null && current !== null && !equal(editing, current);

    const handleCancel = () => {
        if (current) {
            setEditing(JSON.parse(JSON.stringify(current)));
        }
    };

    const handleSave = async () => {
        if (!editing) {
            return;
        }

        setShowSaveDialog(false);
        try {
            console.log("TunersConfigView", "PUT", configAPI, "<-", editing);
            const response = await fetch(configAPI, {
                method: "PUT",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify(editing)
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.reason || `HTTP ${response.status}`);
            }
            setSaveError("");
            setSaved(true);
        } catch (err) {
            setSaveError(err.message);
            console.error(err);
        }
    };

    const handleAddTuner = () => {
        if (!editing) return;
        const i = editing.length;
        const newTuner: ConfigTunersItem = {
            name: `adapter${i}`,
            types: [],
            command: `dvbv5-zap -a ${i} -c ./config/dvbconf-for-isdb/conf/dvbv5_channels_isdbs.conf -r -P <channel>`,
            dvbDevicePath: `/dev/dvb/adapter${i}/dvr0`,
            decoder: "arib-b25-stream-test",
            isDisabled: true
        };
        setEditing([...editing, newTuner]);
    };

    const updateTuner = (index: number, updated: Partial<ConfigTunersItem>) => {
        if (!editing) return;
        const newEditing = [...editing];
        newEditing[index] = { ...newEditing[index], ...updated };
        setEditing(newEditing);
    };

    const deleteTunerProperty = (index: number, key: keyof ConfigTunersItem) => {
        if (!editing) return;
        const newEditing = [...editing];
        const updated = { ...newEditing[index] };
        delete updated[key];
        newEditing[index] = updated;
        setEditing(newEditing);
    };

    const handleUp = (i: number) => {
        if (!editing || i === 0) return;
        const newEditing = [...editing];
        const temp = newEditing[i];
        newEditing[i] = newEditing[i - 1];
        newEditing[i - 1] = temp;
        setEditing(newEditing);
    };

    const handleDown = (i: number) => {
        if (!editing || i === editing.length - 1) return;
        const newEditing = [...editing];
        const temp = newEditing[i];
        newEditing[i] = newEditing[i + 1];
        newEditing[i + 1] = temp;
        setEditing(newEditing);
    };

    const handleRemove = (i: number) => {
        if (!editing) return;
        const newEditing = [...editing];
        newEditing.splice(i, 1);
        setEditing(newEditing);
    };

    const toolbar = (
        <Navbar className="toolbar">
            <Navbar.Group align={Alignment.START}>
                <Navbar.Heading>
                    <Breadcrumbs items={[
                        {
                            text: "チューナー設定"
                        }
                    ]} />
                </Navbar.Heading>
            </Navbar.Group>

            <Navbar.Group align={Alignment.END}>
                <Button
                    minimal
                    intent="success"
                    icon="add"
                    text="Add Tuner"
                    onClick={handleAddTuner}
                />

                <Navbar.Divider />

                <Button
                    minimal
                    intent="danger"
                    icon="undo"
                    text="Cancel"
                    disabled={!hasChanges}
                    onClick={handleCancel}
                />
                <Button
                    intent="primary"
                    icon="saved"
                    text="Save"
                    disabled={!hasChanges}
                    onClick={() => setShowSaveDialog(true)}
                />
            </Navbar.Group>
        </Navbar>
    );

    if (isLoading || !editing || loadError) {
        return (
            <div className="route" id="route-tuners-config-view">
                {toolbar}
                <NonIdealState
                    icon={loadError ? "error" : <Spinner />}
                    title={loadError ? "設定取得エラー" : "ロード中"}
                    description={loadError || "設定を読み込んでいます..."}
                    action={loadError && <Button onClick={() => setReload(value => value + 1)}>再試行</Button>}
                />
            </div>
        );
    }

    return (
        <div className="route" id="route-tuners-config-view">
            {toolbar}

            <div className="content">
                {saveError && <Callout intent="danger">{saveError}</Callout>}
                <HTMLTable className="tuner-table" striped interactive>
                    <thead>
                        <tr>
                            <th style={{ width: "80px" }}>Enable</th>
                            <th style={{ width: "180px" }}>Name</th>
                            <th style={{ width: "120px" }}>Types</th>
                            <th>Options</th>
                            <th style={{ width: "140px", textAlign: "right" }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {editing.map((tuner, i) => (
                            <tr key={i}>
                                <td>
                                    <Switch
                                        checked={!tuner.isDisabled}
                                        onChange={(e) => {
                                            updateTuner(i, { isDisabled: !e.currentTarget.checked });
                                        }}
                                    />
                                </td>
                                <td>
                                    <InputGroup
                                        value={tuner.name || ""}
                                        onChange={(e) => {
                                            updateTuner(i, { name: e.target.value });
                                        }}
                                    />
                                </td>
                                <td>
                                    <div className="types-checkboxes">
                                        {channelTypeOptions.map((type) => {
                                            const checked = tuner.types?.includes(type) ?? false;
                                            return (
                                                <Checkbox
                                                    key={type}
                                                    label={getChannelTypeDisplayName(type)}
                                                    checked={checked}
                                                    inline
                                                    onChange={(e) => {
                                                        let newTypes = [...(tuner.types || [])];
                                                        if (e.currentTarget.checked) {
                                                            newTypes.push(type);
                                                            newTypes = sortTypes(newTypes);
                                                        } else {
                                                            newTypes = newTypes.filter(t => t !== type);
                                                        }
                                                        updateTuner(i, { types: newTypes });
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                </td>
                                <td>
                                    <div className="tuner-options-grid">
                                        <FormGroup label="接続先マシン" helperText="HomeのRemoteで登録した子機を選択できます。">
                                            <HTMLSelect value={tuner.remoteMirakurunId || ""} onChange={e => {
                                                const id = e.target.value;
                                                updateTuner(i, id ? {
                                                    remoteMirakurunId: id, remoteMirakurunHost: undefined,
                                                    remoteMirakurunPort: undefined, command: undefined, dvbDevicePath: undefined
                                                } : { remoteMirakurunId: undefined });
                                            }}>
                                                <option value="">直接指定・ローカルチューナー</option>
                                                {remoteMachines.map(peer => <option key={peer.id} value={peer.id}>{peer.name} ({peer.host}:{peer.port || 40772})</option>)}
                                                {tuner.remoteMirakurunId && !remoteMachines.some(peer => peer.id === tuner.remoteMirakurunId) &&
                                                    <option value={tuner.remoteMirakurunId}>未登録: {tuner.remoteMirakurunId}</option>}
                                            </HTMLSelect>
                                        </FormGroup>
                                        {!tuner.remoteMirakurunHost && !tuner.remoteMirakurunId && (
                                            <>
                                                <FormGroup label="Command">
                                                    <InputGroup
                                                        value={tuner.command || ""}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === "") {
                                                                deleteTunerProperty(i, "command");
                                                            } else {
                                                                updateTuner(i, { command: val });
                                                            }
                                                        }}
                                                    />
                                                </FormGroup>
                                                {isBonRecTestCommand(tuner.command || "") && (
                                                    <FormGroup
                                                        label="BonDriver Helper（実験機能・既定OFF）"
                                                        helperText="未使用チューナーを閉じます。利用には npm run build:bon-helper と Visual C++ Build Tools が必要です。BonDriver・チューニングスペース・チャンネルは既存のCommandから取得します。"
                                                    >
                                                        <Checkbox
                                                            label="BonDriver Helper を有効化"
                                                            checked={tuner.enableBonDriverHelper || false}
                                                            onChange={(e) => {
                                                                if (e.currentTarget.checked) {
                                                                    updateTuner(i, { enableBonDriverHelper: true });
                                                                } else {
                                                                    deleteTunerProperty(i, "enableBonDriverHelper");
                                                                }
                                                            }}
                                                        />
                                                    </FormGroup>
                                                )}
                                                <FormGroup label="DVB Device Path">
                                                    <InputGroup
                                                        value={tuner.dvbDevicePath || ""}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === "") {
                                                                deleteTunerProperty(i, "dvbDevicePath");
                                                            } else {
                                                                updateTuner(i, { dvbDevicePath: val });
                                                            }
                                                        }}
                                                    />
                                                </FormGroup>
                                                {isDvbv5ZapCommand(tuner.command || "") && (
                                                    <div style={{ marginBottom: "8px" }}>
                                                        <Checkbox
                                                            label="Disable DVB Direct"
                                                            checked={tuner.disableDvbDirect || false}
                                                            onChange={(e) => {
                                                                if (e.currentTarget.checked) {
                                                                    updateTuner(i, { disableDvbDirect: true });
                                                                } else {
                                                                    deleteTunerProperty(i, "disableDvbDirect");
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {(!tuner.command || tuner.remoteMirakurunHost || tuner.remoteMirakurunId) && (
                                            <>
                                                {!tuner.remoteMirakurunId && <div className="remote-mirakurun-group">
                                                    <FormGroup label="Remote Mirakurun Host" style={{ flex: 1 }}>
                                                        <InputGroup
                                                            value={tuner.remoteMirakurunHost || ""}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                if (val === "") {
                                                                    deleteTunerProperty(i, "remoteMirakurunHost");
                                                                } else if (/^[0-9a-z.:-]+$/i.test(val)) {
                                                                    updateTuner(i, { remoteMirakurunHost: val });
                                                                }
                                                            }}
                                                        />
                                                    </FormGroup>
                                                    <FormGroup label="Port" style={{ width: "90px" }}>
                                                        <InputGroup
                                                            placeholder="40772"
                                                            value={`${tuner.remoteMirakurunPort || ""}`}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                if (val === "") {
                                                                    deleteTunerProperty(i, "remoteMirakurunPort");
                                                                } else if (/^[0-9]+$/.test(val)) {
                                                                    const port = parseInt(val, 10);
                                                                    if (port <= 65535 && port > 0) {
                                                                        updateTuner(i, { remoteMirakurunPort: port });
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </FormGroup>
                                                </div>}
                                                <div style={{ marginBottom: "8px" }}>
                                                    <Checkbox
                                                        label="Decode (Remote Mirakurun Decoder)"
                                                        checked={tuner.remoteMirakurunDecoder || false}
                                                        onChange={(e) => {
                                                            if (e.currentTarget.checked) {
                                                                updateTuner(i, { remoteMirakurunDecoder: true });
                                                            } else {
                                                                deleteTunerProperty(i, "remoteMirakurunDecoder");
                                                            }
                                                        }}
                                                    />
                                                </div>
                                            </>
                                        )}
                                        {(!(tuner.remoteMirakurunHost || tuner.remoteMirakurunId) || !tuner.remoteMirakurunDecoder) && (
                                            <FormGroup label="Decoder">
                                                <InputGroup
                                                    value={tuner.decoder || ""}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val === "") {
                                                            deleteTunerProperty(i, "decoder");
                                                        } else {
                                                            updateTuner(i, { decoder: val });
                                                        }
                                                    }}
                                                />
                                            </FormGroup>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div className="controls-cell">
                                        <Button
                                            disabled={i === 0}
                                            icon="chevron-up"
                                            onClick={() => handleUp(i)}
                                            minimal
                                        />
                                        <Button
                                            disabled={i === editing.length - 1}
                                            icon="chevron-down"
                                            onClick={() => handleDown(i)}
                                            minimal
                                        />
                                        <Button
                                            icon="trash"
                                            intent="danger"
                                            onClick={() => handleRemove(i)}
                                            minimal
                                        />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </HTMLTable>
            </div>

            {/* Save Confirmation Dialog */}
            <Dialog
                isOpen={showSaveDialog}
                onClose={() => setShowSaveDialog(false)}
                title="Save"
            >
                <DialogBody>
                    <p>設定を保存しますか？</p>
                    <p className="bp5-text-muted">適用するには再起動が必要です。</p>
                </DialogBody>
                <DialogFooter
                    actions={
                        <>
                            <Button onClick={() => setShowSaveDialog(false)}>キャンセル</Button>
                            <Button
                                intent="primary"
                                disabled={!hasChanges}
                                onClick={handleSave}
                            >
                                保存
                            </Button>
                        </>
                    }
                />
            </Dialog>
        </div>
    );
};
