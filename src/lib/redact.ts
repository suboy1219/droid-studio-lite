const ENABLED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

const SUBSTITUTIONS: [string, string][] = [
  ['BUGFLY-WORKER', 'DEMO-WORKER'],
  ['BUG-FLY-DBG', 'DEMO-DBG'],
  ['BUG-FLY', 'DEMO'],
  ['BUGFLY', 'DEMO'],
  ['bugfly', 'demo'],
  ['com.friendtimes', 'com.example.demo'],
  ['com.gf.csgglgl.hwyad.hwy', 'com.example.demo'],
  ['视频定位未确认完成，保留画面并静音继续剧情', 'video sync pending, audio muted']
];

const SYSTEM_PACKAGE = /^com\.(android|google|vivo|qualcomm|mediatek|example)(\b|\.)/;

/**
 * 演示模式（URL 带 ?demo=1）下用于生成截图：替换设备标识、第三方包名与内网地址。
 */
export function redact(input: string): string {
  if (!ENABLED || !input) return input;
  let output = input;
  for (const [from, to] of SUBSTITUTIONS) {
    output = output.split(from).join(to);
  }
  output = output.replace(/\bPD\d{4}[A-Z]*\b/g, 'panther');
  output = output.replace(/\bV\d{4}[A-Z]*\b/g, 'Pixel 8 Pro');
  output = output.replace(/\b(?=[A-Z0-9]{12,32}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g, 'DEMO00000001');
  output = output.replace(/\bcom\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){1,4}\b/g, (pkg) =>
    SYSTEM_PACKAGE.test(pkg) ? pkg : 'com.example.app'
  );
  output = output.replace(/[\w.]+\.hwyad\.hwy\b/g, 'demo.example.app');
  output = output.replace(/bug[-_ ]?fly/gi, 'demo');
  output = output.replace(/libft[\w]*\.so/g, 'libdemo.so');
  output = output.replace(
    /\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/g,
    '192.168.1.42'
  );
  return output;
}

export const REDACT_ENABLED = ENABLED;
