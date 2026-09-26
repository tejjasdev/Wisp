// Code-splitting for components that aren't needed on first paint (stats,
// command palette, multiview…). Renders nothing until the chunk arrives,
// which after the first visit is instant: the service worker has it cached.

import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function lazyComponent(loader) {
  let Component = null;
  let promise = null;
  const load = () =>
    (promise ??= loader()
      .then((module) => (Component = module.default))
      .catch((err) => {
        promise = null; // offline and not cached yet: allow another try later
        throw err;
      }));

  function Lazy(props) {
    const [, setReady] = useState(false);
    useEffect(() => {
      if (Component) return;
      let alive = true;
      load().then(() => alive && setReady(true), () => {});
      return () => (alive = false);
    }, []);
    return Component ? h(Component, props) : null;
  }
  Lazy.preload = load;
  return Lazy;
}
