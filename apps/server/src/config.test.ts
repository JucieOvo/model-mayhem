/**
 * 服务端运行路径和更新默认配置测试。
 *
 * 作者：JucieOvo
 *
 * 测试直接调用真实配置加载函数，验证相对路径基准和稳定更新通道默认值。
 */

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config";

describe("loadServerConfig", () => {
  it("把发行配置中的相对路径解析到仓库根目录", () => {
    const config = loadServerConfig({
      MODELMAYHEM_DATA_DIR: "./data",
      MODELMAYHEM_AGENT_RUNTIME_DIR: "./data/agent-runtime",
      MODELMAYHEM_WEB_DIR: "./apps/web/dist",
      MODELMAYHEM_LOG_DIR: "./data/logs",
      MODELMAYHEM_UPDATE_REPOSITORY: "",
    });

    expect(config.dataDirectory).toBe(resolve(process.cwd(), "data"));
    expect(config.agentRuntimeDirectory).toBe(resolve(process.cwd(), "data", "agent-runtime"));
    expect(config.webDirectory).toBe(resolve(process.cwd(), "apps", "web", "dist"));
    expect(config.logDirectory).toBe(resolve(process.cwd(), "data", "logs"));
  });

  it("stable 渠道默认使用公开稳定分支", () => {
    const config = loadServerConfig({});

    expect(config.updateRepository).toBe("https://github.com/JucieOvo/model-mayhem.git");
    expect(config.updateContentBranch).toBe("content/stable");
    expect(config.updateBalanceBranch).toBe("balance/stable");
    expect(config.updateContentPaths).toEqual(["presentation", "thumbnails", "questions"]);
    expect(config.updateBalancePaths).toEqual([
      "cards",
      "balance",
      "decks",
      "research",
      "eras",
      "doctrines",
    ]);
    expect(config.updateChannel).toBe("stable");
  });

  it("显式空仓库可以关闭远端更新", () => {
    const config = loadServerConfig({ MODELMAYHEM_UPDATE_REPOSITORY: "" });

    expect(config.updateRepository).toBeUndefined();
  });

  it("预览渠道默认分别读取卡面和数值 next 分支", () => {
    const config = loadServerConfig({ MODELMAYHEM_UPDATE_CHANNEL: "preview" });

    expect(config.updateContentBranch).toBe("content/next");
    expect(config.updateBalanceBranch).toBe("balance/next");
  });

  it("自定义渠道可以分别指定两个来源", () => {
    const config = loadServerConfig({
      MODELMAYHEM_UPDATE_CHANNEL: "custom",
      MODELMAYHEM_CONTENT_BRANCH: "fork/content",
      MODELMAYHEM_BALANCE_BRANCH: "fork/balance",
      MODELMAYHEM_CONTENT_PATHS: "presentation,thumbnails",
      MODELMAYHEM_BALANCE_PATHS: "cards,balance,decks",
    });

    expect(config.updateContentBranch).toBe("fork/content");
    expect(config.updateBalanceBranch).toBe("fork/balance");
    expect(config.updateContentPaths).toEqual(["presentation", "thumbnails"]);
    expect(config.updateBalancePaths).toEqual(["cards", "balance", "decks"]);
  });

  it("控制令牌必须满足最小长度", () => {
    expect(() =>
      loadServerConfig({
        MODELMAYHEM_CONTROL_TOKEN: "short-token",
      }),
    ).toThrow("至少需要 32 个字符");
  });
});
