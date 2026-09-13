/**
 * 系统、更新与诊断页面。
 *
 * 作者：JucieOvo
 *
 * 控制令牌只保存在当前浏览器会话，用于更新、回滚和诊断接口鉴权，不写入长期存储。
 */

import type { DiagnosticSummary, UpdateStatus } from "@modelmayhem/contracts";
import { Download, RefreshCw, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { readSessionControlToken, writeSessionControlToken } from "../controlToken";

export function SettingsPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSummary | null>(null);
  const [controlToken, setControlToken] = useState(readSessionControlToken);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "install" | "rollback" | "export" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function readDiagnostics(statusValue: UpdateStatus, token: string): Promise<void> {
    if (statusValue.controlTokenRequired && token.trim().length === 0) {
      setDiagnostics(null);
      setDiagnosticsError("需要输入控制令牌后才能读取诊断信息");
      return;
    }
    try {
      setDiagnostics(await api.getDiagnostics(token.trim() || undefined));
      setDiagnosticsError(null);
    } catch (reason) {
      setDiagnostics(null);
      setDiagnosticsError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function refresh(): Promise<void> {
    const statusValue = await api.getUpdateStatus();
    setStatus(statusValue);
    await readDiagnostics(statusValue, controlToken);
  }

  useEffect(() => {
    let cancelled = false;
    void api
      .getUpdateStatus()
      .then(async (statusValue) => {
        if (cancelled) {
          return;
        }
        setStatus(statusValue);
        const token = readSessionControlToken();
        if (statusValue.controlTokenRequired && token.trim().length === 0) {
          setDiagnostics(null);
          setDiagnosticsError("需要输入控制令牌后才能读取诊断信息");
          return;
        }
        try {
          const diagnosticsValue = await api.getDiagnostics(token.trim() || undefined);
          if (!cancelled) {
            setDiagnostics(diagnosticsValue);
            setDiagnosticsError(null);
          }
        } catch (reason) {
          if (!cancelled) {
            setDiagnostics(null);
            setDiagnosticsError(reason instanceof Error ? reason.message : String(reason));
          }
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: "check" | "install" | "rollback"): Promise<void> {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const token = controlToken.trim() || undefined;
      if (action === "check") {
        const result = await api.checkUpdate(token);
        setMessage(result.message);
      } else if (action === "install") {
        const result = await api.installUpdate(token);
        setMessage(result.message);
      } else {
        const result = await api.rollbackUpdate(token);
        setMessage(result.message);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setBusy("export");
    setError(null);
    try {
      const blob = await api.downloadDiagnostics(controlToken.trim() || undefined);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `model-mayhem-diagnostics-${Date.now()}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  if (error && !status) {
    return <ErrorMessage message={error} />;
  }
  if (!status) {
    return <LoadingMessage label="读取发行状态" />;
  }

  const tokenMissing = status.controlTokenRequired && controlToken.trim().length === 0;
  const updateControlDisabled = busy !== null || tokenMissing || !status.enabled;

  return (
    <div className="page-screen settings-page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <strong>系统更新</strong>
            <div className="mt-1 text-xs text-[var(--muted)]">{status.message}</div>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={updateControlDisabled}
            onClick={() => void run("check")}
          >
            <RefreshCw size={16} />
            {busy === "check" ? "检查中" : "检查更新"}
          </button>
        </div>
        <div className="panel-body grid grid-cols-2 gap-4">
          <div className="col-span-2 grid grid-cols-[1fr_auto] gap-3 rounded-[7px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <label className="grid gap-2">
              <span className="text-xs text-[var(--muted)]">控制令牌</span>
              <input
                className="field"
                type="password"
                value={controlToken}
                autoComplete="off"
                placeholder={status.controlTokenRequired ? "本部署必须填写" : "当前无需填写"}
                onChange={(event) => {
                  setControlToken(event.target.value);
                  writeSessionControlToken(event.target.value);
                }}
                onBlur={() => void readDiagnostics(status, controlToken)}
              />
            </label>
            <button
              type="button"
              className="ghost-button self-end"
              disabled={busy !== null}
              onClick={() => void readDiagnostics(status, controlToken)}
            >
              读取诊断
            </button>
          </div>
          <Info label="更新状态" value={status.enabled ? "已配置" : "未配置"} />
          <Info label="安装完整性" value={status.integrity} />
          <Info label="卡面版本" value={status.active?.contentVersion ?? "本地内容"} />
          <Info label="卡面提交" value={status.active?.contentCommit ?? "local"} />
          <Info label="数值版本" value={status.active?.balanceVersion ?? "本地内容"} />
          <Info label="数值提交" value={status.active?.balanceCommit ?? "local"} />
          <Info label="待安装卡面" value={status.pendingContentVersion ?? "无"} />
          <Info label="待安装数值" value={status.pendingBalanceVersion ?? "无"} />
          <Info label="更新渠道" value={status.channel} />
          <Info label="卡面分支" value={status.contentBranch ?? "内置内容"} />
          <Info label="数值分支" value={status.balanceBranch ?? "内置内容"} />
          <Info label="回滚点" value={status.rollbackAvailable ? "可用" : "无"} />
          <div className="col-span-2 flex gap-3">
            <button
              type="button"
              className="action-button primary"
              disabled={
                (!status.pendingContentCommit && !status.pendingBalanceCommit) ||
                updateControlDisabled
              }
              onClick={() => void run("install")}
            >
              <Upload size={16} />
              {busy === "install" ? "安装中" : "安装待更新内容"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!status.rollbackAvailable || updateControlDisabled}
              onClick={() => void run("rollback")}
            >
              <RotateCcw size={16} />
              {busy === "rollback" ? "回滚中" : "回滚上一版本"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} color="var(--accent)" />
            <strong>诊断与秘密保护</strong>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={busy !== null || tokenMissing}
            onClick={() => void exportDiagnostics()}
          >
            <Download size={16} />
            {busy === "export" ? "导出中" : "导出诊断包"}
          </button>
        </div>
        {diagnostics ? (
          <div className="panel-body grid grid-cols-2 gap-4">
            <Info label="应用版本" value={diagnostics.appVersion} />
            <Info label="卡面版本" value={diagnostics.contentVersion} />
            <Info label="数值版本" value={diagnostics.balanceVersion} />
            <Info
              label="DeepSeek Key"
              value={diagnostics.deepSeekKeyConfigured ? "已配置，值不会展示" : "未配置"}
            />
            <Info label="沙盒模式" value={diagnostics.sandboxEnabled ? "已启用" : "未启用"} />
            <Info
              label="数据目录"
              value={diagnostics.dataDirectoryConfigured ? "已配置" : "未配置"}
            />
            <Info
              label="Agent 隔离目录"
              value={diagnostics.agentRuntimeDirectoryConfigured ? "已配置" : "未配置"}
            />
            <Info
              label="日志目录"
              value={diagnostics.logDirectoryConfigured ? "已配置" : "未配置"}
            />
          </div>
        ) : (
          <div className="panel-body">
            <ErrorMessage message={diagnosticsError ?? "诊断信息暂不可用"} />
          </div>
        )}
      </section>

      <ErrorMessage message={error} />
      {message ? <div className="battle-action-notice success">{message}</div> : null}
    </div>
  );
}

function Info({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="settings-info-card rounded-[7px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
