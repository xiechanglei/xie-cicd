import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const APP_DIR = path.join(os.homedir(), '.xie-cicd');

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validateName(label, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} 不能为空`);
  }
  const normalized = value.trim();
  if (!NAME_PATTERN.test(normalized)) {
    throw new Error(`${label} 只能包含英文、数字、下划线和连字符，且必须以英文或数字开头`);
  }
  return normalized;
}

export function toProjectDir(projectName) {
  return path.join(APP_DIR, projectName);
}

export function toSrcDir(projectName) {
  return path.join(toProjectDir(projectName), 'src');
}

export function toBuildDir(projectName) {
  return path.join(toProjectDir(projectName), 'build');
}

export function toConfigPath(projectName) {
  return path.join(toProjectDir(projectName), 'config.json');
}

export async function ensureAppDir() {
  await fs.mkdir(APP_DIR, { recursive: true });
}

export async function ensureProjectStructure(projectName) {
  await ensureAppDir();
  await fs.mkdir(toSrcDir(projectName), { recursive: true });
  await fs.mkdir(toBuildDir(projectName), { recursive: true });
}

export async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function loadProjectConfig(projectName) {
  return readJson(toConfigPath(projectName));
}

export async function saveProjectConfig(projectName, config) {
  await ensureProjectStructure(projectName);
  await writeJson(toConfigPath(projectName), config);
}

export async function listProjects() {
  await ensureAppDir();
  const entries = await fs.readdir(APP_DIR, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const configPath = toConfigPath(entry.name);
    try {
      const config = await readJson(configPath);
      projects.push({
        name: entry.name,
        ...config,
      });
    } catch {
      continue;
    }
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

export async function listBuildArchives(projectName) {
  const buildDir = toBuildDir(projectName);
  const entries = await fs.readdir(buildDir, { withFileTypes: true });
  const archives = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.zip')) {
      continue;
    }
    const fullPath = path.join(buildDir, entry.name);
    const stats = await fs.stat(fullPath);
    archives.push({
      name: entry.name,
      path: fullPath,
      size: stats.size,
      mtime: stats.mtime,
    });
  }

  archives.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return archives;
}

export function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function buildArchiveName(projectName, environmentName, date = new Date()) {
  return `${projectName}-${environmentName}-${timestampForFilename(date)}.zip`;
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * cicd-client 的配置文件路径，与 cicd 同一数据目录，用文件名区分
 */
export function toClientConfigPath() {
  return path.join(APP_DIR, 'client.json');
}

export async function loadClientConfig() {
  try {
    const config = await readJson(toClientConfigPath());
    return Array.isArray(config) ? config : [];
  } catch {
    // 配置文件不存在或格式错误时返回空列表
    return [];
  }
}

export async function saveClientConfig(config) {
  await ensureAppDir();
  await writeJson(toClientConfigPath(), config);
}
