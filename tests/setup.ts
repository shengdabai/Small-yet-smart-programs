// Preloaded by bunfig.toml before every test file: route scripts/db.ts to a
// throwaway SQLite file so tests never touch data/miner.db, and keep Firecrawl
// away from the operator's real key file.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "smart-programs-test-"));
process.env.SMART_PROGRAMS_DB = join(scratch, "miner.db");
process.env.FIRECRAWL_ENV_FILE = join(scratch, "missing.env");
delete process.env.FIRECRAWL_API_KEY;
