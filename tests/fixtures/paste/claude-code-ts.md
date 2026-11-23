Here's a typed debounce you can drop in:

```ts
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
```

A few notes:

1. It uses `ReturnType<typeof setTimeout>` so it works in browsers and Node.
2. Trailing-edge only; add a `leading` flag if you need it.
