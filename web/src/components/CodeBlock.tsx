import { useState } from 'react';

export default function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-wrap">
      <button className="btn sm code-copy" onClick={() => void copy()}>
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="code-block">{code}</pre>
    </div>
  );
}
