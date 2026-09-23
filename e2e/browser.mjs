// Utilidades compartidas para pruebas E2E: lanza Chromium con WebGL (SwiftShader).
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

export async function launch() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
}
