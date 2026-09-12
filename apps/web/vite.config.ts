/**
 * Vite 参考客户端构建配置。
 *
 * 作者：JucieOvo
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const serverTarget = environment.MODELMAYHEM_SERVER_URL ?? "http://127.0.0.1:3210";
  const port = Number(environment.MODELMAYHEM_WEB_PORT ?? "5173");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`MODELMAYHEM_WEB_PORT 无效：${environment.MODELMAYHEM_WEB_PORT}`);
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: environment.MODELMAYHEM_WEB_HOST ?? "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": serverTarget,
        "/mcp": serverTarget,
      },
    },
    preview: {
      host: environment.MODELMAYHEM_WEB_HOST ?? "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": serverTarget,
        "/mcp": serverTarget,
      },
    },
  };
});
