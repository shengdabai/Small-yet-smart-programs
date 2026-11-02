/**
 * 运营者画像加载器。
 *
 * 优先读 config/profile.local.json(本机真实画像,gitignored),
 * 不存在则回退 config/profile.example.json(repo 内占位)。
 *
 * 这样 repo 里永远不含 PII,本机运行又能用真实画像做 D6 资产匹配评分 + 决策矩阵。
 */
import { readFileSync, existsSync } from "node:fs";

export type CurrentProject = { name: string; stage: string; est: number; fit: string };
export type Profile = {
  owner: string;
  assets: string[];
  currentProjects: CurrentProject[];
};

const CONFIG_DIR = decodeURIComponent(new URL("../config/", import.meta.url).pathname);

export function loadProfile(): Profile {
  const local = CONFIG_DIR + "profile.local.json";
  const example = CONFIG_DIR + "profile.example.json";
  const path = existsSync(local) ? local : example;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return {
    owner: raw.owner ?? "the operator",
    assets: Array.isArray(raw.assets) ? raw.assets : [],
    currentProjects: Array.isArray(raw.currentProjects) ? raw.currentProjects : [],
  };
}
