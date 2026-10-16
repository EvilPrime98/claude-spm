import os from "node:os";
import path from "node:path";

/**
 * Resolves the directory holding globally installed skills.
 *
 * Uses `SPM_GLOBAL_DIR` when set, otherwise `~/.claude/skills`.
 *
 * @returns {string} Absolute path to the global skills directory.
 */
export const globalSkillsDir = () =>
  process.env.SPM_GLOBAL_DIR ?? path.join(os.homedir(), ".claude", "skills");

/**
 * Resolves the directory used to cache cloned skill repositories.
 *
 * Uses `SPM_CACHE_DIR` when set, otherwise `~/.cache/spm`.
 *
 * @returns {string} Absolute path to the cache directory.
 */
export const cacheDir = () => process.env.SPM_CACHE_DIR ?? path.join(os.homedir(), ".cache", "spm");

/**
 * Builds the spm-related file paths for a project.
 *
 * @param {string} [cwd=process.cwd()] Project root directory.
 * @returns {{claudeDir: string, skillsDir: string, manifest: string, state: string, settings: string}} Paths to `.claude`, `.claude/skills`, `spm.json`, `.claude/.spm-state.json` and `.claude/settings.json`.
 */
export const projectPaths = (cwd = process.cwd()) => {
  const claudeDir = path.join(cwd, ".claude");
  return {
    claudeDir,
    skillsDir: path.join(claudeDir, "skills"),
    manifest: path.join(cwd, "spm.json"),
    state: path.join(claudeDir, ".spm-state.json"),
    settings: path.join(claudeDir, "settings.json"),
  };
};
