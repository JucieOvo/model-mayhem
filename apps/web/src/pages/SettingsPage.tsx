/**
 * 系统、更新与诊断页面。
 *
 * 作者：JucieOvo
 */

import type { DiagnosticSummary, UpdateStatus } from "@modelmayhem/contracts";
import { Download, RefreshCw, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";

export function SettingsPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "install" | "rollback" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [statusValue, diagnosticsValue] = await Promise.all([
      api.getUpdateStatus(),
      api.getDiagnostics(),
    ]);
    setStatus(statusValue);
    setDiagnostics(diagnosticsValue);
  }

  useEffect(() => {
    void Promise.all([api.getUpdateStatus(), api.getDiagnostics()])
      .then(([statusValue, diagnosticsValue]) => {
        setStatus(statusValue);
        setDiagnostics(diagnosticsValue);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  async function run(action: "check" | "install" | "rollback"): Promise<void> {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      if (action === "check") {
        const result = await api.checkUpdate();
        setMessage(result.message);
      } else if (action === "install") {
        const result = await api.installUpdate();
        setMessage(result.message);
      } else {
        const result = await api.rollbackUpdate();
        setMessage(result.message);
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  if (!status || !diagnostics) {
    return <LoadingMessage label="读取发行状态" />;
  }

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
            disabled={busy !== null}
            onClick={() => void run("check")}
          >
            <RefreshCw size={16} />
            {busy === "check" ? "检查中" : "检查更新"}
          </button>
        </div>
        <div className="panel-body grid grid-cols-2 gap-4">
          <Info label="更新状态" value={status.enabled ? "已配置" : "未配置"} />
          <Info label="安装完整性" value={status.integrity} />
          <Info label="内容版本" value={status.active?.contentVersion ?? "本地内容"} />
          <Info label="内容提交" value={status.active?.contentCommit ?? "local"} />
          <Info label="待安装提交" value={status.pendingCommit ?? "无"} />
          <Info label="更新渠道" value={status.channel} />
          <Info label="更新分支" value={status.branch ?? "内置内容"} />
          <div className="col-span-2 flex gap-3">
            <button
              type="button"
              className="action-button primary"
              disabled={!status.pendingCommit || busy !== null}
              onClick={() => void run("install")}
            >
              <Upload size={16} />
              {busy === "install" ? "安装中" : "安装待更新内容"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy !== null}
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
          <a className="ghost-button" href="/api/diagnostics/export" download>
            <Download size={16} />
            导出诊断包
          </a>
        </div>
        <div className="panel-body grid grid-cols-2 gap-4">
          <Info label="应用版本" value={diagnostics.appVersion} />
          <Info label="内容版本" value={diagnostics.contentVersion} />
          <Info
            label="DeepSeek Key"
            value={diagnostics.deepSeekKeyConfigured ? "已配置，值不会展示" : "未配置"}
          />
          <Info label="沙盒模式" value={diagnostics.sandboxEnabled ? "已启用" : "未启用"} />
          <Info label="数据目录" value={diagnostics.dataDirectory} />
          <Info label="Agent 隔离目录" value={diagnostics.agentRuntimeDirectory} />
          <Info label="日志目录" value={diagnostics.logDirectory} />
        </div>
      </section>

      <ErrorMessage message={error} />
      {message ? <div className="battle-action-notice success">{message}</div> : null}
    </div>
  );
}

function Info({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-[7px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-1 break-all text-sm">{value}</div>
    </div>
  );
}
