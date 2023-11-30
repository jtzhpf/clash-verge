import fs from "fs-extra";
import zlib from "zlib";
import path from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import proxyAgent from "https-proxy-agent";
import { execSync } from "child_process";
import axios from "axios";
import { log } from "console";

const cwd = process.cwd();
const TEMP_DIR = path.join(cwd, "node_modules/.verge");
const FORCE = process.argv.includes("--force");

const SIDECAR_HOST = execSync("rustc -vV")
  .toString()
  .match(/(?<=host: ).+(?=\s*)/g)[0];

/* ======= clash meta ======= */
const VERSION_URL =
  "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt";
const META_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha`;
let META_VERSION;

const META_MAP = {
  "win32-x64": "mihomo-windows-amd64-compatible",
  "darwin-x64": "mihomo-darwin-amd64",
  "darwin-arm64": "mihomo-darwin-arm64",
  "linux-x64": "mihomo-linux-amd64-compatible",
  "linux-arm64": "mihomo-linux-arm64",
};

/**
 * Fetch the latest release version from the version.txt file
 */
async function getLatestVersion() {
  try {
    const response = await axios.get(VERSION_URL);
    META_VERSION = response.data.trim(); // Trim to remove extra whitespaces
    console.log(`Latest release version: ${META_VERSION}`);
  } catch (error) {
    console.error("Error fetching latest release version:", error.message);
    process.exit(1);
  }
}

/**
 * Check available
 */
const { platform, arch } = process;

if (!META_MAP[`${platform}-${arch}`]) {
  throw new Error(`clash meta unsupported platform "${platform}-${arch}"`);
}

function mihomo() {
  const name = META_MAP[`${platform}-${arch}`];
  const isWin = platform === "win32";
  const urlExt = isWin ? "zip" : "gz";
  const downloadURL = `${META_URL_PREFIX}/${name}-${META_VERSION}.${urlExt}`;
  const exeFile = `${name}${isWin ? ".exe" : ""}`;
  const zipFile = `${name}-${META_VERSION}.${urlExt}`;

  console.log({
    name: name,
    targetFile: `mihomo-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  });
  return {
    name: name,
    targetFile: `mihomo-${SIDECAR_HOST}${isWin ? ".exe" : ""}`,
    exeFile,
    zipFile,
    downloadURL,
  };
}

/**
 * download sidecar and rename
 */
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, downloadURL } = binInfo;

  const sidecarDir = path.join(cwd, "src-tauri", "sidecar");
  const sidecarPath = path.join(sidecarDir, targetFile);

  await fs.mkdirp(sidecarDir);
  if (!FORCE && (await fs.pathExists(sidecarPath))) return;

  const tempDir = path.join(TEMP_DIR, name);
  const tempZip = path.join(tempDir, zipFile);
  const tempExe = path.join(tempDir, exeFile);

  await fs.mkdirp(tempDir);
  try {
    if (!(await fs.pathExists(tempZip))) {
      await downloadFile(downloadURL, tempZip);
    }

    if (zipFile.endsWith(".zip")) {
      const zip = new AdmZip(tempZip);
      zip.getEntries().forEach((entry) => {
        console.log(`[DEBUG]: "${name}" entry name`, entry.entryName);
      });
      zip.extractAllTo(tempDir, true);
      await fs.rename(tempExe, sidecarPath);
      console.log(`[INFO]: "${name}" unzip finished`);
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip);
      const writeStream = fs.createWriteStream(sidecarPath);
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          console.error(`[ERROR]: "${name}" gz failed:`, error.message);
          reject(error);
        };
        readStream
          .pipe(zlib.createGunzip().on("error", onError))
          .pipe(writeStream)
          .on("finish", () => {
            console.log(`[INFO]: "${name}" gunzip finished`);
            execSync(`chmod 755 ${sidecarPath}`);
            console.log(`[INFO]: "${name}" chmod binary finished`);
            resolve();
          })
          .on("error", onError);
      });
    }
  } catch (err) {
    // 需要删除文件
    await fs.remove(sidecarPath);
    throw err;
  } finally {
    // delete temp dir
    await fs.remove(tempDir);
  }
}

/**
 * download the file to the resources dir
 */
async function resolveResource(binInfo) {
  const { file, downloadURL } = binInfo;

  const resDir = path.join(cwd, "src-tauri/resources");
  const targetPath = path.join(resDir, file);

  if (!FORCE && (await fs.pathExists(targetPath))) return;

  await fs.mkdirp(resDir);
  await downloadFile(downloadURL, targetPath);

  console.log(`[INFO]: ${file} finished`);
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path) {
  const options = {};

  const httpProxy =
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy;

  if (httpProxy) {
    options.agent = proxyAgent(httpProxy);
  }

  const response = await fetch(url, {
    ...options,
    method: "GET",
    headers: { "Content-Type": "application/octet-stream" },
  });
  const buffer = await response.arrayBuffer();
  await fs.writeFile(path, new Uint8Array(buffer));

  console.log(`[INFO]: download finished "${url}"`);
}

/**
 * main
 */
const SERVICE_URL =
  "https://github.com/MetaCubeX/clash-verge-service/releases/download/latest";

const resolveService = () =>
  resolveResource({
    file: "clash-verge-service.exe",
    downloadURL: `${SERVICE_URL}/clash-verge-service.exe`,
  });
const resolveInstall = () =>
  resolveResource({
    file: "install-service.exe",
    downloadURL: `${SERVICE_URL}/install-service.exe`,
  });
const resolveUninstall = () =>
  resolveResource({
    file: "uninstall-service.exe",
    downloadURL: `${SERVICE_URL}/uninstall-service.exe`,
  });
const resolveMmdb = () =>
  resolveResource({
    file: "Country.mmdb",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb`,
  });
const resolveGeosite = () =>
  resolveResource({
    file: "geosite.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`,
  });
const resolveGeoIP = () =>
  resolveResource({
    file: "geoip.dat",
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`,
  });

const tasks = [
  {
    name: "mihomo",
    func: () => getLatestVersion().then(() => resolveSidecar(mihomo())),
    retry: 3,
  },
  { name: "service", func: resolveService, retry: 3, winOnly: true },
  { name: "install", func: resolveInstall, retry: 3, winOnly: true },
  { name: "uninstall", func: resolveUninstall, retry: 3, winOnly: true },
  { name: "mmdb", func: resolveMmdb, retry: 3 },
  { name: "geosite", func: resolveGeosite, retry: 3 },
  { name: "geoip", func: resolveGeoIP, retry: 3 },
];

async function runTask() {
  const task = tasks.shift();
  if (!task) return;
  if (task.winOnly && process.platform !== "win32") return runTask();

  for (let i = 0; i < task.retry; i++) {
    try {
      await task.func();
      break;
    } catch (err) {
      console.error(`[ERROR]: task::${task.name} try ${i} ==`, err.message);
      if (i === task.retry - 1) throw err;
    }
  }
  return runTask();
}

runTask();
runTask();
