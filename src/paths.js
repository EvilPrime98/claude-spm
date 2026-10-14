import os from "node:os";
import path from "node:path";

export const globalSkillsDir = () =>
  process.env.SPM_GLOBAL_DIR ?? path.join(os.homedir(), ".claude", "skills");

export const projectPaths = (cwd = process.cwd()) => {
  const claudeDir = path.join(cwd, ".claude");
  return {
    claudeDir,
    skillsDir: path.join(claudeDir, "skills"),
    manifest: path.join(claudeDir, "skills.json"),
    settings: path.join(claudeDir, "settings.json"),
  };
};
