import { useEffect } from 'react';
import { Home } from './Home';
import Plan from './Plan';
import { usePathname } from './router';

export default function App() {
  const path = usePathname();
  const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
  const slug = segments[0];
  const isLegacyCapacity = segments[1] === 'capacity';

  // Fold legacy /<slug>/capacity URL into the unified single-page view.
  useEffect(() => {
    if (isLegacyCapacity && slug) {
      window.history.replaceState(null, '', '/' + slug);
      window.dispatchEvent(new Event('app-navigate'));
    }
  }, [isLegacyCapacity, slug]);

  if (path === '/' || path === '') return <Home />;
  if (!slug) return <Home />;
  return <Plan key={slug} slug={slug} />;
}
