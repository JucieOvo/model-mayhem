/**
 * Drizzle Kit 迁移配置。
 *
 * 作者：JucieOvo
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
