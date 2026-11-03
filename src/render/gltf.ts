// 加载 public/models/ 下的 glTF 模型（Blender 导出的 .glb）。
// claude.ai Artifact 试玩页不托管 .glb 文件：发布时把模型转成 base64 文本（<名字>.glb.txt，见 tools/artifact-page.mjs），
// 页面里设置 window.__modelExt = '.txt'，这里取回文本后在浏览器里解码再解析。普通网站不受影响。

import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/** path：相对网站根目录的模型路径，例如 'models/trees.glb' */
export async function loadGltf(path: string): Promise<GLTF> {
  const loader = new GLTFLoader();
  const ext = (window as { __modelExt?: string }).__modelExt;
  if (!ext) return loader.loadAsync(new URL(path, document.baseURI).href);
  const res = await fetch(new URL(path + ext, document.baseURI).href);
  if (!res.ok) throw new Error(`${path}${ext}: HTTP ${res.status}`);
  const s = atob((await res.text()).trim());
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return loader.parseAsync(bytes.buffer, '');
}
