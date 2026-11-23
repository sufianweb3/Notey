The fix is small: in `useAutosave`, compare **`rev`** before writing, and treat a ~~409~~ **conflict** as a signal to show the banner rather than an error. See the [React docs on effects](https://react.dev/learn/you-might-not-need-an-effect) for why the reset belongs in a key, not an effect.

Use ***both*** emphasis styles sparingly.
