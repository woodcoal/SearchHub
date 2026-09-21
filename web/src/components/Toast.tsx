import { useEffect, useState } from 'react';
import Icon from './Icon';

export type ToastKind = 'ok' | 'err' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit(): void {
  for (const listener of listeners) listener([...items]);
}

export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

/** 浮层通知：任何地方都能调用，默认成功后 4 秒自动消失、失败 8 秒 */
export function toast(text: string, kind: ToastKind = 'info', durationMs?: number): number {
  const id = (seq += 1);
  const ttl = durationMs ?? (kind === 'err' ? 8000 : 4000);
  items = [...items, { id, kind, text }];
  emit();
  setTimeout(() => dismissToast(id), ttl);
  return id;
}

export const toastOk = (text: string, durationMs?: number) => toast(text, 'ok', durationMs);
export const toastErr = (text: string, durationMs?: number) => toast(text, 'err', durationMs);

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    const listener: Listener = (next) => setList(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {list.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          <Icon name={item.kind === 'ok' ? 'check' : item.kind === 'err' ? 'close' : 'info'} size={15} />
          <span className="toast-text">{item.text}</span>
          <button className="toast-close" aria-label="关闭通知" onClick={() => dismissToast(item.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
