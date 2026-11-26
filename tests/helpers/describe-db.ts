import { describe } from "vitest";
import { hasTestDb } from "./db";

/** Like `describe`, but skipped when TEST_DATABASE_URL is not set (see tests/setup.ts). */
export const describeDb: typeof describe = hasTestDb
  ? describe
  : (describe.skip as unknown as typeof describe);
