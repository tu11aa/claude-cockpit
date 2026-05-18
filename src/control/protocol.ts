// src/control/protocol.ts
export function encodeMsg(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export function createDecoder() {
  let buf = "";
  return {
    push(chunk: string): unknown[] {
      buf += chunk;
      const out: unknown[] = [];
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      return out;
    },
  };
}
